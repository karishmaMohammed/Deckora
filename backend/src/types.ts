export interface OutlineItem {
  id: string;
  title: string;
  description: string;
}

export interface Outline {
  items: OutlineItem[];
}

export interface PositionedItem extends OutlineItem {
  position: number;
}

export type StreamEvent =
  | { type: "token"; text: string }
  | { type: "tool_start"; id: string; name: string; input: unknown }
  | { type: "tool_end"; id: string; name: string; output: unknown }
  | { type: "outline"; items: PositionedItem[] }
  | { type: "done" }
  | { type: "error"; message: string };

export const MUTATING_TOOLS = new Set([
  "create_outline",
  "add_item",
  "update_item",
  "move_item",
  "delete_item",
]);
