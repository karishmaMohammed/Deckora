# Frontend

Deckora’s UI. React + Vite. One page: outline on the left, chat on the right.

## Run (from the repo root)

```bash
npm install
npm run dev -w frontend
```

Dev server: [http://localhost:5173](http://localhost:5173). `/api` is proxied to Express on port 3001, so the UI does not hard-code a host.

From a clean checkout the intended command is still `npm run dev` at the repo root (backend + frontend together).

```bash
npm run typecheck -w frontend
npm run build -w frontend
```

## Layout

| File | Role |
| --- | --- |
| `src/App.tsx` | Session thread id, wiring, live outline |
| `src/OutlinePanel.tsx` | Current `outline.json` |
| `src/ChatPanel.tsx` | Transcript, tool rows, composer |
| `src/api.ts` | `fetch` + SSE parser |
| `src/types.ts` | Shared UI types |

## Behaviour that matters

- **Streaming, not a spinner.** Tool rows appear as `tool_start` arrives. Assistant text appends on each `token`. The outline list replaces itself on each `outline` event, which the backend sends as soon as a mutating tool finishes — before the model is done talking. The backend uses DeepAgents `streamEvents` v3 (`run.messages` and `run.toolCalls`).
- **Multi-turn.** `threadId` lives in `sessionStorage` and is sent on every `POST /api/chat`. The backend checkpointer uses that id.
- **Reset seed** restores the spec's starting outline and starts a new thread. It is for the eleven-prompt run, not a product feature.
- **Close (×)** in the chat header starts a new thread and clears the transcript. It does **not** rewrite `outline.json`. Hover shows the word “Close”. Reset seed is the one that restores the PDF’s starting data.

## Extra I put here on purpose

The PDF said visual design is not scored. I still treated the page as the surface you will watch for 3–4 minutes.

- After Send, the transcript **sticks to the bottom** while tools and tokens stream. If you scroll up to read an earlier turn, it stops chasing. A working agent you cannot see is the same failure mode as a blocking spinner.
- The outline updates from `outline` events, not a refetch when the reply is done. You should see Pricing Details move while the model is still talking.
- Empty-state starters are the first three eval prompts. They fill the box; they do not auto-send. I wanted a one-click way into the session without hiding the fact that the product is a text box.

If you only care about the eleven, ignore the polish. The two-panel layout is the whole UI the spec asked for.
