import { useEffect, useId, useRef, useState } from "react";
import { fetchOutline, resetOutline, streamChat } from "./api.ts";
import { ChatPanel } from "./ChatPanel.tsx";
import { OutlinePanel } from "./OutlinePanel.tsx";
import type { ChatMessage, OutlineItem } from "./types.ts";

function threadId(): string {
  const key = "deckora-thread";
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;
  const id = crypto.randomUUID();
  sessionStorage.setItem(key, id);
  return id;
}

export function App() {
  const [items, setItems] = useState<OutlineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const thread = useRef(threadId());
  const assistantId = useId();
  const counter = useRef(0);

  useEffect(() => {
    fetchOutline()
      .then(setItems)
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Failed to load outline";
        setMessages([
          {
            id: "boot-error",
            role: "assistant",
            content: "",
            tools: [],
            error: message,
          },
        ]);
      })
      .finally(() => setLoading(false));
  }, []);

  async function onReset() {
    setResetting(true);
    try {
      setItems(await resetOutline());
      sessionStorage.removeItem("deckora-thread");
      thread.current = threadId();
      setMessages([]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Reset failed";
      setMessages((prev) => [
        ...prev,
        { id: `reset-${counter.current++}`, role: "assistant", content: "", tools: [], error: message },
      ]);
    } finally {
      setResetting(false);
    }
  }

  function onCloseChat() {
    if (busy) return;
    sessionStorage.removeItem("deckora-thread");
    thread.current = threadId();
    setMessages([]);
    setInput("");
  }

  async function onSend() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);

    const userId = `user-${counter.current++}`;
    const replyId = `${assistantId}-${counter.current++}`;
    setMessages((prev) => [
      ...prev,
      { id: userId, role: "user", content: text, tools: [] },
      { id: replyId, role: "assistant", content: "", tools: [], streaming: true },
    ]);

    const patchReply = (updater: (message: ChatMessage) => ChatMessage) => {
      setMessages((prev) =>
        prev.map((message) => (message.id === replyId ? updater(message) : message)),
      );
    };

    try {
      await streamChat(text, thread.current, (event) => {
        if (event.type === "token") {
          patchReply((message) => ({ ...message, content: message.content + event.text }));
          return;
        }
        if (event.type === "tool_start") {
          patchReply((message) => ({
            ...message,
            tools: [
              ...message.tools,
              { id: event.id, name: event.name, input: event.input, status: "running" },
            ],
          }));
          return;
        }
        if (event.type === "tool_end") {
          patchReply((message) => ({
            ...message,
            tools: message.tools.map((tool) =>
              tool.id === event.id || (tool.name === event.name && tool.status === "running")
                ? { ...tool, id: event.id, output: event.output, status: "done" }
                : tool,
            ),
          }));
          return;
        }
        if (event.type === "outline") {
          setItems(event.items);
          return;
        }
        if (event.type === "error") {
          patchReply((message) => ({ ...message, error: event.message, streaming: false }));
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Chat failed";
      patchReply((current) => ({ ...current, error: message }));
    } finally {
      patchReply((message) => ({ ...message, streaming: false }));
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <header className="brand">
        <p className="brand-name">Deckora</p>
        <p className="brand-tag">Talk to your outline</p>
      </header>
      <OutlinePanel items={items} loading={loading} onReset={onReset} resetting={resetting} />
      <ChatPanel
        messages={messages}
        input={input}
        onInput={setInput}
        onSend={onSend}
        onClose={onCloseChat}
        busy={busy}
      />
    </div>
  );
}
