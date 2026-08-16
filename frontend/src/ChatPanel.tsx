import { useLayoutEffect, useRef } from "react";
import type { ChatMessage } from "./types.ts";

interface ChatPanelProps {
  messages: ChatMessage[];
  input: string;
  onInput: (value: string) => void;
  onSend: () => void;
  onClose: () => void;
  busy: boolean;
}

const STARTERS = [
  "What's in my outline?",
  "Move the intro to the end.",
  "Delete the pricing slide.",
];

function preview(value: unknown): string {
  if (value === undefined) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 180 ? `${text.slice(0, 180)}…` : text;
}

export function ChatPanel({
  messages,
  input,
  onInput,
  onSend,
  onClose,
  busy,
}: ChatPanelProps) {
  const transcriptRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  function onTranscriptScroll() {
    const el = transcriptRef.current;
    if (!el) return;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottom.current = gap < 80;
  }

  useLayoutEffect(() => {
    if (busy) stickToBottom.current = true;
    const el = transcriptRef.current;
    if (!el || !stickToBottom.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  return (
    <section className="panel chat-panel">
      <header className="panel-header">
        <div>
          <p className="eyebrow">Agent</p>
          <h1>Chat</h1>
        </div>
        <button
          type="button"
          className="icon-btn"
          aria-label="Close"
          title="Close"
          onClick={onClose}
          disabled={busy || messages.length === 0}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path
              d="M3.2 3.2 12.8 12.8M12.8 3.2 3.2 12.8"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
          <span className="tip">Close</span>
        </button>
      </header>
      <div
        className="transcript"
        aria-live="polite"
        ref={transcriptRef}
        onScroll={onTranscriptScroll}
      >
        {messages.length === 0 ? (
          <div className="empty-chat">
            <p className="empty-title">Tell Deckora what to change</p>
            <p className="muted intro">
              The agent calls tools behind the scenes. You never type item IDs.
            </p>
            <div className="starters">
              {STARTERS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  className="starter"
                  onClick={() => onInput(prompt)}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {messages.map((message) => (
          <article key={message.id} className={`bubble ${message.role}`}>
            {message.tools.length > 0 ? (
              <ul className="tools">
                {message.tools.map((tool) => (
                  <li key={tool.id} className={tool.status}>
                    <span className={`dot ${tool.status}`} />
                    <span className="tool-name">{tool.name}</span>
                    <span className="tool-status">
                      {tool.status === "running" ? "running" : "done"}
                    </span>
                    {tool.status === "done" && tool.output !== undefined ? (
                      <pre>{preview(tool.output)}</pre>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {message.content ? <p className="body">{message.content}</p> : null}
            {message.streaming && !message.content && message.tools.length === 0 ? (
              <p className="muted pulse">Working…</p>
            ) : null}
            {message.error ? <p className="error">{message.error}</p> : null}
          </article>
        ))}
      </div>
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          onSend();
        }}
      >
        <textarea
          value={input}
          onChange={(event) => onInput(event.target.value)}
          placeholder="What’s in my outline?"
          rows={2}
          disabled={busy}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onSend();
            }
          }}
        />
        <button type="submit" className="send" disabled={busy || !input.trim()}>
          {busy ? "Sending" : "Send"}
        </button>
      </form>
    </section>
  );
}
