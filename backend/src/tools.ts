import { tool } from "langchain";
import { z } from "zod";
import { createChatModel } from "./model.ts";
import {
  addItem,
  deleteItems,
  moveItem,
  readOutline,
  replaceOutline,
  updateItem,
  withPositions,
} from "./outlineStore.ts";
import type { PositionedItem } from "./types.ts";

const generatedItemSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
});

const generatedOutlineSchema = z.object({
  items: z.array(generatedItemSchema).min(1),
});

function ok(items: PositionedItem[]): string {
  return JSON.stringify({ ok: true, items });
}

function fail(error: unknown, items?: PositionedItem[]): string {
  const message = error instanceof Error ? error.message : String(error);
  const current = items ? { items } : {};
  return JSON.stringify({ ok: false, error: message, ...current });
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Model did not return JSON.");
  }
  return JSON.parse(candidate.slice(start, end + 1)) as unknown;
}

/**
 * create_outline must generate items with its own model call — not copy, not reuse
 * the agent loop. We ask for structured JSON and fall back to parsing free text.
 */
async function generateOutlineItems(
  topic: string,
  itemCount: number,
): Promise<Array<{ title: string; description: string }>> {
  const model = createChatModel({ temperature: 0.4 });
  const instruction = [
    "Generate a presentation outline from scratch.",
    `Topic: ${topic}`,
    `Number of items: ${itemCount}`,
    "Return JSON only, no markdown, of the form:",
    '{"items":[{"title":"...","description":"..."}]}',
    "Titles: 3–8 words, no numbering.",
    "Descriptions: one short sentence.",
    "Do not include an appendix unless the topic genuinely needs one.",
  ].join("\n");

  try {
    const structured = model.withStructuredOutput(generatedOutlineSchema);
    const result = await structured.invoke(instruction);
    return result.items.slice(0, itemCount);
  } catch {
    const raw = await model.invoke(instruction);
    const content = typeof raw.content === "string" ? raw.content : JSON.stringify(raw.content);
    const parsed = generatedOutlineSchema.parse(extractJsonObject(content));
    return parsed.items.slice(0, itemCount);
  }
}

export const listOutlineTool = tool(
  async () => {
    try {
      const outline = await readOutline();
      return ok(withPositions(outline.items));
    } catch (error) {
      return fail(error);
    }
  },
  {
    name: "list_outline",
    description:
      "Return the current outline with 1-based positions, ids, titles, and descriptions. Call this before mutating when you are not certain of current IDs or order. Takes no arguments.",
    schema: z.object({}),
  },
);

export const createOutlineTool = tool(
  async ({ topic, itemCount }) => {
    try {
      const count = itemCount ?? 6;
      if (count < 1 || count > 20) {
        return fail("itemCount must be between 1 and 20.");
      }
      const generated = await generateOutlineItems(topic, count);
      const items = await replaceOutline(generated);
      return ok(items);
    } catch (error) {
      return fail(error);
    }
  },
  {
    name: "create_outline",
    description:
      "Wipe the current outline and generate a brand-new one from a topic. Items are produced by a separate model call, not copied. Use only when the user wants to start over on a new subject. Optional itemCount defaults to 6.",
    schema: z.object({
      topic: z
        .string()
        .min(1)
        .describe("What the new outline is about, in the user's words."),
      itemCount: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .describe("How many items to generate. Default 6."),
    }),
  },
);

export const addItemTool = tool(
  async ({ title, description, position }) => {
    try {
      const items = await addItem({ title, description, position });
      return ok(items);
    } catch (error) {
      try {
        const outline = await readOutline();
        return fail(error, withPositions(outline.items));
      } catch {
        return fail(error);
      }
    }
  },
  {
    name: "add_item",
    description:
      "Insert a new outline item. Omit position to append at the end. Pass a 1-based position to insert there (existing items at that position and after shift down).",
    schema: z.object({
      title: z.string().min(1).describe("Title of the new item."),
      description: z
        .string()
        .optional()
        .describe("Optional one-sentence description. Empty if the user did not give one."),
      position: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("1-based insert position. Omit to append."),
    }),
  },
);

export const updateItemTool = tool(
  async ({ id, title, description }) => {
    try {
      if (title === undefined && description === undefined) {
        return fail("Provide a new title, a new description, or both.");
      }
      const items = await updateItem({ id, title, description });
      return ok(items);
    } catch (error) {
      try {
        const outline = await readOutline();
        return fail(error, withPositions(outline.items));
      } catch {
        return fail(error);
      }
    }
  },
  {
    name: "update_item",
    description:
      "Edit an existing item by id. Pass the new title and/or the new description. Resolve the id from list_outline — users will not give you ids.",
    schema: z.object({
      id: z.string().min(1).describe("Item id from list_outline."),
      title: z.string().min(1).optional().describe("Replacement title, if renaming."),
      description: z
        .string()
        .optional()
        .describe("Replacement description, if changing the body copy."),
    }),
  },
);

export const moveItemTool = tool(
  async ({ id, position }) => {
    try {
      const items = await moveItem(id, position);
      return ok(items);
    } catch (error) {
      try {
        const outline = await readOutline();
        return fail(error, withPositions(outline.items));
      } catch {
        return fail(error);
      }
    }
  },
  {
    name: "move_item",
    description:
      "Move an item so that its final 1-based position is `position`. Example: moving the last item to position 1 puts it at the top; moving an item to the current length puts it at the end.",
    schema: z.object({
      id: z.string().min(1).describe("Item id from list_outline."),
      position: z
        .number()
        .int()
        .min(1)
        .describe("Final 1-based position after the move."),
    }),
  },
);

export const deleteItemTool = tool(
  async ({ ids }) => {
    try {
      if (ids.length === 0) {
        return fail("ids must contain at least one item id.");
      }
      const items = await deleteItems(ids);
      return ok(items);
    } catch (error) {
      try {
        const outline = await readOutline();
        return fail(error, withPositions(outline.items));
      } catch {
        return fail(error);
      }
    }
  },
  {
    name: "delete_item",
    description:
      "Remove one or more items by id. Pass every id in a single call. If the user's phrasing is ambiguous (two items could match), do not call this — ask them which one.",
    schema: z.object({
      ids: z
        .array(z.string().min(1))
        .min(1)
        .describe("Ids to delete, from list_outline."),
    }),
  },
);

export const outlineTools = [
  listOutlineTool,
  createOutlineTool,
  addItemTool,
  updateItemTool,
  moveItemTool,
  deleteItemTool,
];
