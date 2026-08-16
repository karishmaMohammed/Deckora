export interface OutlineItem {
  id: string;
  title: string;
  description: string;
  position: number;
}

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
  output?: unknown;
  status: "running" | "done";
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  tools: ToolCall[];
  streaming?: boolean;
  error?: string;
}

export type SseEvent =
  | { type: "token"; text: string }
  | { type: "tool_start"; id: string; name: string; input: unknown }
  | { type: "tool_end"; id: string; name: string; output: unknown }
  | { type: "outline"; items: OutlineItem[] }
  | { type: "done" }
  | { type: "error"; message: string };
