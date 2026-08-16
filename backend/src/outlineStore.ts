import fs from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { config } from "./config.ts";
import type { Outline, OutlineItem, PositionedItem } from "./types.ts";

let writeChain: Promise<unknown> = Promise.resolve();

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function newId(): string {
  return randomBytes(3).toString("hex");
}

export function withPositions(items: OutlineItem[]): PositionedItem[] {
  return items.map((item, index) => ({ ...item, position: index + 1 }));
}

async function readUnlocked(): Promise<Outline> {
  const raw = await fs.readFile(config.outlinePath, "utf8");
  const parsed = JSON.parse(raw) as Outline;
  if (!Array.isArray(parsed.items)) {
    throw new Error("outline.json is missing an items array.");
  }
  return parsed;
}

async function writeUnlocked(outline: Outline): Promise<void> {
  await fs.writeFile(
    config.outlinePath,
    `${JSON.stringify(outline, null, 2)}\n`,
    "utf8",
  );
}

export async function readOutline(): Promise<Outline> {
  return withLock(readUnlocked);
}

export async function resetOutlineFromSeed(): Promise<Outline> {
  return withLock(async () => {
    const seed = await fs.readFile(config.seedPath, "utf8");
    await fs.writeFile(config.outlinePath, seed.endsWith("\n") ? seed : `${seed}\n`);
    return JSON.parse(seed) as Outline;
  });
}

function clampPosition(position: number, length: number): number {
  if (!Number.isInteger(position)) {
    throw new Error(`Position must be an integer, got ${position}.`);
  }
  if (length === 0) return 1;
  if (position < 1 || position > length) {
    throw new Error(`Position ${position} is out of range. Valid positions: 1–${length}.`);
  }
  return position;
}

export async function replaceOutline(
  items: Array<{ title: string; description: string }>,
): Promise<PositionedItem[]> {
  return withLock(async () => {
    const outline: Outline = {
      items: items.map((item) => ({
        id: newId(),
        title: item.title.trim(),
        description: item.description.trim(),
      })),
    };
    await writeUnlocked(outline);
    return withPositions(outline.items);
  });
}

export async function addItem(input: {
  title: string;
  description?: string;
  position?: number;
}): Promise<PositionedItem[]> {
  return withLock(async () => {
    const outline = await readUnlocked();
    const item: OutlineItem = {
      id: newId(),
      title: input.title.trim(),
      description: (input.description ?? "").trim(),
    };
    if (input.position === undefined) {
      outline.items.push(item);
    } else {
      const position = clampPosition(input.position, outline.items.length + 1);
      outline.items.splice(position - 1, 0, item);
    }
    await writeUnlocked(outline);
    return withPositions(outline.items);
  });
}

export async function updateItem(input: {
  id: string;
  title?: string;
  description?: string;
}): Promise<PositionedItem[]> {
  return withLock(async () => {
    const outline = await readUnlocked();
    const item = outline.items.find((entry) => entry.id === input.id);
    if (!item) {
      throw new Error(`No item with id "${input.id}".`);
    }
    if (input.title !== undefined) item.title = input.title.trim();
    if (input.description !== undefined) item.description = input.description.trim();
    await writeUnlocked(outline);
    return withPositions(outline.items);
  });
}

export async function moveItem(id: string, position: number): Promise<PositionedItem[]> {
  return withLock(async () => {
    const outline = await readUnlocked();
    const from = outline.items.findIndex((entry) => entry.id === id);
    if (from === -1) {
      throw new Error(`No item with id "${id}".`);
    }
    const target = clampPosition(position, outline.items.length);
    const [item] = outline.items.splice(from, 1);
    if (!item) {
      throw new Error(`No item with id "${id}".`);
    }
    // Position is the final 1-based index after the move.
    const to = Math.min(target - 1, outline.items.length);
    outline.items.splice(to, 0, item);
    await writeUnlocked(outline);
    return withPositions(outline.items);
  });
}

export async function deleteItems(ids: string[]): Promise<PositionedItem[]> {
  return withLock(async () => {
    const outline = await readUnlocked();
    const unique = [...new Set(ids)];
    const missing = unique.filter(
      (id) => !outline.items.some((item) => item.id === id),
    );
    if (missing.length > 0) {
      throw new Error(`No item(s) with id: ${missing.map((id) => `"${id}"`).join(", ")}.`);
    }
    const remove = new Set(unique);
    outline.items = outline.items.filter((item) => !remove.has(item.id));
    await writeUnlocked(outline);
    return withPositions(outline.items);
  });
}
