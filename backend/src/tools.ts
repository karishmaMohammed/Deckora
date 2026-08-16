import { tool } from "langchain";
import { z } from "zod";
import { createChatModel } from "./model.ts";
import {
  addItem,
  deleteItems,
  moveItem,
  moveItemAfter,
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

function messageText(message: { content: unknown }): string {
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part) {
        return String((part as { text?: unknown }).text ?? "");
      }
      return "";
    })
    .join("");
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

function itemsFromUnknown(value: unknown, itemCount: number): Array<{ title: string; description: string }> {
  const parsed = generatedOutlineSchema.parse(value);
  const items = parsed.items
    .map((item) => ({
      title: item.title.trim(),
      description: item.description.trim(),
    }))
    .filter((item) => item.title.length > 0);
  if (items.length < 1) {
    throw new Error("Generated outline was empty.");
  }
  return items.slice(0, itemCount);
}

/**
 * Nested model call inside create_outline — required by the spec (generate,
 * don't copy). Forced tool call so we get real fields, not JS-style `{items:...}`
 * which JSON.parse rejects at column 2.
 */
async function generateOutlineItemsOnce(
  topic: string,
  itemCount: number,
): Promise<Array<{ title: string; description: string }>> {
  const model = createChatModel({ temperature: 0.4 });
  const instruction = [
    "Generate a presentation outline from scratch.",
    `Topic: ${topic}`,
    `Number of items: ${itemCount} (exactly that many).`,
    "Titles: 3–8 words, no numbering.",
    "Descriptions: one short sentence.",
    "Do not include an appendix unless the topic genuinely needs one.",
    "Call submit_outline once with the items. Do not reply with JSON in the message text.",
  ].join("\n");

  const submit = tool(
    async (input: { items: Array<{ title: string; description: string }> }) => input,
    {
      name: "submit_outline",
      description: "Submit the generated outline items.",
      schema: generatedOutlineSchema,
    },
  );

  const bound = model.bindTools([submit], { tool_choice: "submit_outline" });
  const result = await bound.invoke(instruction);
  const call =
    result.tool_calls?.find((entry) => entry.name === "submit_outline") ??
    result.tool_calls?.[0];
  if (call?.args) {
    return itemsFromUnknown(call.args, itemCount);
  }

  return itemsFromUnknown(extractJsonObject(messageText(result)), itemCount);
}

async function generateOutlineItems(
  topic: string,
  itemCount: number,
): Promise<Array<{ title: string; description: string }>> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await generateOutlineItemsOnce(topic, itemCount);
    } catch (error) {
      lastError = error;
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Could not generate outline items: ${message}`);
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
      "Wipe the current outline and generate a brand-new one from a topic. Items are produced by a separate model call inside this tool, not copied. This is the ONLY way to start over. Never approximate it by delete_item + add_item, and never paste JSON into the chat. Optional itemCount defaults to 6.",
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
  async ({ id, position, after_id }) => {
    try {
      if (after_id && position !== undefined) {
        return fail("Pass either position or after_id, not both.");
      }
      if (!after_id && position === undefined) {
        return fail("Pass position (1-based final index) or after_id (place immediately after that item).");
      }
      const items = after_id
        ? await moveItemAfter(id, after_id)
        : await moveItem(id, position!);
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
      "Move an item. For 'to the top/end' or a numbered slot, pass `position` (final 1-based index; current length = end). For 'right after X', pass `after_id` of X — do not compute X's position plus one from an earlier turn. After a delete in this turn, read the delete result before moving.",
    schema: z.object({
      id: z.string().min(1).describe("Item id from list_outline."),
      position: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Final 1-based position after the move. Omit when using after_id."),
      after_id: z
        .string()
        .min(1)
        .optional()
        .describe("Place this item immediately after this id. Preferred for 'right after X'."),
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
      "Remove one or more items by id. Call this only after the user's words uniquely identify the item(s). Pass several ids in one call only when they named each item (e.g. Market Landscape and Next Steps). If a singular phrase could match more than one title — especially 'the pricing slide' vs Pricing Overview and Pricing Details — do not call this tool; ask which one. Never delete every item that shares a word with the request.",
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
