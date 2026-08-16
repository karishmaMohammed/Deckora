# Backend

Deckora’s agent. Express + TypeScript (strict) + **deepagents@1.10.8**. Six tools and `outline.json`.

## Run (from the repo root)

```bash
npm install
cp .env.example .env   # fill in a key
npm run dev -w backend
```

Listens on `http://127.0.0.1:3001`. In the full app, `npm run dev` at the root starts this and the frontend together.

```bash
npm run reset-outline     # restore backend/data/outline.json from the seed
npm run typecheck -w backend
```

## Layout

| File | Role |
| --- | --- |
| `src/index.ts` | Checks that a key is present, then starts HTTP |
| `src/http.ts` | `GET /api/outline`, `POST /api/chat` (SSE), `POST /api/outline/reset` |
| `src/agent.ts` | `createDeepAgent({ model, tools, systemPrompt, checkpointer })` |
| `src/prompt.ts` | System prompt: IDs, ambiguity, six tools only |
| `src/tools.ts` | Zod tool schemas. `create_outline` calls the model itself |
| `src/outlineStore.ts` | JSON file, 1-based positions, serialised writes |
| `src/model.ts` | `anthropic` (`ChatAnthropic`) or `openai` (`ChatOpenAI`) |
| `src/config.ts` | Env: provider, model, keys |
| `src/stream.ts` | DeepAgents `streamEvents` v3 (`messages` + `toolCalls`) → SSE |
| `src/usageLog.ts` | Per-hit token / USD / INR logs in the terminal |
| `data/outline.json` | Live outline (git-tracked seed copy) |
| `data/outline.seed.json` | Immutable copy of the spec's starting data |

## Routes

- `GET /api/health` — `{ ok, model }`
- `GET /api/outline` — current items with 1-based `position`
- `POST /api/outline/reset` — rewrite from the seed (used by the UI before an eval run)
- `POST /api/chat` — `{ message, threadId }` → `text/event-stream` with `token`, `tool_start`, `tool_end`, `outline`, `done`, `error`

## Tools

Six, no seventh:

1. `list_outline` — no params, returns the file with positions
2. `create_outline` — `{ topic, itemCount? }` — nested model call, then replace file
3. `add_item` — `{ title, description?, position? }`
4. `update_item` — `{ id, title?, description? }`
5. `move_item` — `{ id, position? }` or `{ id, after_id? }`
6. `delete_item` — `{ ids: string[] }`

DeepAgents built-ins (filesystem, todos, subagent `task`) are excluded via harness profile. See the root README for why.

## Notes for a reviewer

- Conversations are in-memory (`MemorySaver`). Restart the process, lose the chat; the outline file stays.
- `create_outline` is the only tool that spends a second model call. That is required by the spec ("the items are generated, not copied").
- Tool errors are JSON the model can read, not HTTP errors. The turn should recover or ask, not 500.
- Watch the process stdout on each Send: `[llm] hit N` with `in=` / `out=` and a rupee estimate.

## Extra I put here on purpose

These are not in the PDF. I added them after using the app like a reviewer would.

**Cost visibility.** DeepAgents is a loop. Logging one “chat request” would lie about spend. Each underlying chat-model call is a hit. INR uses the active model’s list price × ~₹95.5 / USD — enough to feel the cost, not a billing system.

**Serialised JSON writes.** Two tools in one turn (prompt 8) must not interleave read/modify/write on `outline.json`. A tiny promise queue in `outlineStore.ts` is the whole “database”.

The policy that actually matters (ask, don’t guess / don’t invent an appendix) still lives in `prompt.ts` and in the tool descriptions — that *is* the spec. This folder is just how I made the spec runnable without surprises.
