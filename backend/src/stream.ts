import { getAgent } from "./agent.ts";
import { readOutline, withPositions } from "./outlineStore.ts";
import { MUTATING_TOOLS, type StreamEvent } from "./types.ts";

const HIDDEN_FROM_UI = new Set([
  "ls",
  "read_file",
  "write_file",
  "edit_file",
  "glob",
  "grep",
  "execute",
  "write_todos",
  "task",
]);

function toolOutputText(output: unknown): unknown {
  if (output && typeof output === "object" && "content" in output) {
    return (output as { content: unknown }).content;
  }
  return output;
}

type QueueItem = StreamEvent | { type: "__error"; error: unknown } | { type: "__end" };

/**
 * Merge the two v3 projections onto one generator. They must be consumed
 * concurrently — waiting on messages then tools (or the reverse) can stall.
 */
export async function* streamAgentTurn(
  message: string,
  threadId: string,
): AsyncGenerator<StreamEvent> {
  const agent = getAgent();
  const run = await agent.streamEvents(
    { messages: [{ role: "user", content: message }] },
    {
      version: "v3",
      configurable: { thread_id: threadId },
    },
  );

  const queue: QueueItem[] = [];
  let wake: (() => void) | undefined;
  let pending = 2;

  const enqueue = (item: QueueItem) => {
    queue.push(item);
    wake?.();
  };

  const finished = () => {
    pending -= 1;
    if (pending === 0) enqueue({ type: "__end" });
    else wake?.();
  };

  void (async () => {
    try {
      for await (const msg of run.messages) {
        for await (const token of msg.text) {
          if (token) enqueue({ type: "token", text: token });
        }
      }
    } catch (error) {
      enqueue({ type: "__error", error });
    } finally {
      finished();
    }
  })();

  void (async () => {
    try {
      for await (const call of run.toolCalls) {
        const name = String(call.name);
        if (HIDDEN_FROM_UI.has(name)) {
          await call.output.catch(() => undefined);
          continue;
        }
        const id = String(call.callId ?? name);
        enqueue({
          type: "tool_start",
          id,
          name,
          input: call.input,
        });
        const output = await call.output;
        enqueue({
          type: "tool_end",
          id,
          name,
          output: toolOutputText(output),
        });
        if (MUTATING_TOOLS.has(name)) {
          const outline = await readOutline();
          enqueue({ type: "outline", items: withPositions(outline.items) });
        }
      }
    } catch (error) {
      enqueue({ type: "__error", error });
    } finally {
      finished();
    }
  })();

  while (true) {
    while (queue.length === 0) {
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
      wake = undefined;
    }
    const next = queue.shift();
    if (!next) continue;
    if (next.type === "__end") break;
    if (next.type === "__error") {
      throw next.error instanceof Error ? next.error : new Error(String(next.error));
    }
    yield next;
  }

  await run.output;
  yield { type: "done" };
}
