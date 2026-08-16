import type { OutlineItem, SseEvent } from "./types.ts";

export async function fetchOutline(): Promise<OutlineItem[]> {
  const response = await fetch("/api/outline");
  if (!response.ok) {
    throw new Error(`Failed to load outline (${response.status})`);
  }
  const data = (await response.json()) as { items: OutlineItem[] };
  return data.items;
}

export async function resetOutline(): Promise<OutlineItem[]> {
  const response = await fetch("/api/outline/reset", { method: "POST" });
  if (!response.ok) {
    throw new Error(`Failed to reset outline (${response.status})`);
  }
  const data = (await response.json()) as { items: OutlineItem[] };
  return data.items;
}

function parseSseBlock(block: string): SseEvent | null {
  const lines = block.split("\n");
  let eventName = "";
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (!eventName || dataLines.length === 0) return null;
  return JSON.parse(dataLines.join("\n")) as SseEvent;
}

export async function streamChat(
  message: string,
  threadId: string,
  onEvent: (event: SseEvent) => void,
): Promise<void> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, threadId }),
  });

  if (!response.ok || !response.body) {
    const text = await response.text();
    throw new Error(text || `Chat failed (${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const event = parseSseBlock(part.trim());
      if (event) onEvent(event);
    }
    if (done) break;
  }

  if (buffer.trim()) {
    const event = parseSseBlock(buffer.trim());
    if (event) onEvent(event);
  }
}
