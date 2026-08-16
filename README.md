# Deckora

Talk to your outline. Two panels: the document on the left, chat on the right. You type what you want in plain English. The agent calls tools. The outline file updates.

This is the take-home for Marvin / StrategyConnect.

```bash
npm install
cp .env.example .env   # then put in a key
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Frontend is Vite on 5173; backend is Express on 3001. Vite proxies `/api`.

## Env

Anthropic or OpenAI. Put a key in `.env` at the repo root.

| Variable | What it does |
| --- | --- |
| `LLM_PROVIDER` | `anthropic` (default) or `openai`. If unset, inferred from which key is present |
| `LLM_MODEL` | Optional. Defaults: `claude-sonnet-4-5` / `gpt-4o-mini` |
| `ANTHROPIC_API_KEY` | Claude |
| `OPENAI_API_KEY` | OpenAI (and OpenAI-compatible hosts with `LLM_BASE_URL`) |
| `LLM_BASE_URL` | Optional. Only used for OpenAI |

To use OpenAI instead: `LLM_PROVIDER=openai`, `OPENAI_API_KEY`, optionally `LLM_MODEL=gpt-4o`.

To reset `backend/data/outline.json` to the shipped seed (also a button in the UI):

```bash
npm run reset-outline
```

Start from that seed before the eleven-prompt run.

Separate install/run notes: [backend/README.md](backend/README.md), [frontend/README.md](frontend/README.md).

Node 20+.

---

## Design decisions

The interesting part of this exercise is not the feature list. These are the calls I made and why.

### Stack

The spec pins **deepagents 1.10.x** and prefers NestJS, with Express allowed. I used Express. DeepAgents is the library I had not used; Express I have. Picking up both at once would have spent time on Nest module wiring that this app does not need: one JSON file, one agent, three routes.

Frontend is React + Vite, one page, two panels.

Storage is `backend/data/outline.json`. Writes are serialised through an in-memory lock so two tool calls in one turn cannot interleave read/modify/write. There is no database.

The model is `LLM_PROVIDER` (`anthropic` or `openai`) plus `LLM_MODEL`. I ran it on Claude Sonnet; a reviewer can swap to OpenAI by changing env. Temperature is 0 on the agent so tool choice is as stable as the model allows. `create_outline` uses a second call at 0.4 because that one is generating copy, not resolving IDs.

### Exactly six tools

DeepAgents is a harness. Out of the box it also exposes filesystem tools, `write_todos`, and `task` (subagents). The spec is six tools and no seventh.

I kept `createDeepAgent({ model, tools, systemPrompt, checkpointer })` as the entry point, then hid the extras with a harness profile: `excludedTools` plus `generalPurposeSubagent: { enabled: false }`. I still tell the model in the system prompt to ignore anything that is not the six, in case a built-in leaks through.

I considered wrapping `createAgent` from LangChain instead of DeepAgents so the extras would never exist. That would have been cleaner for "six tools" and worse for the brief, which is explicit that this is the library they run.

### Tools are for the model, not for humans

Users never see IDs. Tools only accept IDs (except `list_outline` and `create_outline`). Getting from "the intro" to `a1` is the agent's job, using `list_outline`.

That split is deliberate. If `delete_item` took a title and fuzzy-matched, "delete the pricing slide" would silently pick one of two pricing items. The wrong layer would be making a product decision. The tool stays dumb and returns structured errors (`ok: false` plus the current outline). The agent is the one that is allowed to ask.

Descriptions are written for the model as the reader: when to call, when not to, what "position" means, that `create_outline` is destructive. Return values always include 1-based positions so the next call in the same turn does not have to guess.

I used snake_case names (`list_outline`, not `list-outline`). Both are fine; snake_case is what these models emit most reliably for function names.

Positions are **final 1-based index after the operation**. "Move X to the end" with six items is position 6. "Right after Introduction" uses `move_item` with `after_id` of Introduction so a stale +1 from the original seed cannot put it at slot 2. The store clamps out-of-range numbered positions and returns an error rather than wrapping.

### Ambiguity is a first-class path

The eleven prompts are not a CRUD checklist. Several of them are underspecified on purpose.

**"Delete the pricing slide."** There are two: Pricing Overview and Pricing Details. The agent should ask which one. Deleting both is overreach. Deleting the first match is a guess. I would rather look slow and honest on camera than look clever and wrong.

**"Move the appendix to the top."** There is no appendix. The agent should say so and ask. It must not invent an appendix, must not call `create_outline`, and must not move some other item as a "best effort". Inventing work is worse than refusing.

**"Move Competitive Analysis to the top and rename it to Competitive Position."** Two tools, one turn, only if the item is unique.

**"Start over with a new outline about our Q3 expansion into Southeast Asia."** That is `create_outline`. The items are generated by a nested model call inside the tool, not assembled from templates. If the user had said "add a section about Q3" I would `add_item` instead. Wiping is reserved for a clear restart.

If the agent asks a question, the next user message continues the same LangGraph thread (`MemorySaver` + `thread_id`). The UI keeps `thread_id` in `sessionStorage` so a refresh in the same tab does not drop memory. Resetting the seed also mints a new thread, because keeping old conversation state against a fresh file would be a lie.

### Streaming

A spinner until the whole turn returns does not meet the bar. The backend streams SSE from DeepAgents `streamEvents` v3 (`run.messages` and `run.toolCalls`):

- `tool_start` / `tool_end` — required. You can see which tool ran and with what.
- `token` — assistant text as it arrives, when the model streams tokens.
- `outline` — emitted after any mutating tool so the left panel updates before the model has finished talking.

I considered WebSockets. SSE is enough for one-way agent output and simpler to proxy through Vite. I considered polling `GET /api/outline`. Polling would update the panel, but it would not show tool activity, and it would make the UI feel like a refresh loop instead of an agent working.

### What I dropped

- **NestJS.** Time. Same behaviour, more files.
- **A title-matching tool.** It would hide the ambiguity the exercise is testing.
- **Confirmations / HITL interrupts** on delete and create. The spec wants an agent that just does it. Asking is reserved for missing information, not for "are you sure".
- **Persisting conversations to disk.** The spec asked for outline persistence, not chat persistence. `MemorySaver` is enough for one session. Recreating the process starts a new conversation; `outline.json` on disk does not.
- **Tests beyond the typechecker.** They said they are not scoring coverage. If I had more time I would unit-test the store (move/insert off-by-ones) and run the eleven prompts as a script with a mocked model that I could inspect.

### What I would do with more time

1. Record traces (LangSmith) for the eleven-prompt session and keep a fixture of expected tool graphs, not expected wording.
2. If a provider still flakes on the nested `create_outline` tool call, add a second structured-output method behind a flag rather than letting the agent rebuild with `add_item`.
3. If streaming of tool calls is thin on a given model, special-case the UI to still show `tool_start` immediately even when tokens never arrive.
4. Add a "current outline" snapshot into the system prompt at the start of each turn so `list_outline` is not needed on every mutate. I did **not** do this on purpose: IDs and order would then live in two places (prompt vs file) and drift after a tool. Listing is slower and consistent.
5. Show a short "why I asked" when the agent refuses to guess, so a reviewer who was not in my head can see the policy fire.

---

## Beyond the PDF — extra work I chose to do

The brief is small on purpose. Everything below is optional relative to the eleven prompts. I still did it because these are the kinds of problems that show up the moment a real person uses an agent, not only when the eval script is running.

**1. I wanted to see what each hit actually cost.**  
One Send is not one API call — it is a tool loop (often 2–4 requests, plus an extra nested call on `create_outline`). I log each hit in the backend terminal: input tokens, output tokens, USD, and INR (Sonnet $3 / $15 per 1M, or OpenAI rates when that provider is on). Turn total and session total sit underneath.

**2. The left panel is a live document, not a refresh.**  
Mutating tools emit an `outline` SSE event as soon as they finish, so the list moves while the model is still talking. I also auto-scroll the transcript on Send and while tokens stream, and stop following if you scroll up. A spinner that blocks until the turn ends was explicitly out; a transcript you have to chase by hand felt the same.

**3. Harness extras stayed hidden.**  
DeepAgents ships filesystem / todo / subagent tools. The spec is six. I kept `createDeepAgent` (you asked for that entry point) and hid the rest with a harness profile rather than switching libraries. That was the smallest way to honour both “use this library” and “don’t add a seventh tool”.

**4. UI is not the score, but the recording is.**  
I still spent a pass on the page: two cards, live tool rows, starter prompts, a close (×) that starts a new thread without wiping `outline.json`, Reset seed for a fair eval. Visual design is unstated; a messy demo would still waste the 3–4 minutes you asked for.

**5. Things I noticed while building, not listed in the PDF**  
- Positions are 1-based *after* the move, not “index in the old array”. Off-by-ones here fail prompt 2 and 4 quietly.  
- `create_outline` must call a model *inside the tool*. Reusing the agent’s last message would be copying, which the spec forbids.  
- Conversation memory and file state can disagree after Reset seed — so reset also mints a new `thread_id`.  
- Streaming in deepagents 1.10.x is `streamEvents` v3 (`run.messages` + `run.toolCalls`), not the older event iterable. I used the API this pin actually exports.

None of this is meant to inflate the task. If something above is in the way of reviewing the eleven, skip it. The product is still: type a sentence, tools run, the outline on disk changes.

## The eleven prompts — intended behaviour

Run these in order, one session, from a fresh seed. Answer the agent the way a person would.

| # | Prompt | What I expect |
| --- | --- | --- |
| 1 | What's in my outline? | `list_outline`, then a readable list |
| 2 | Move the intro to the end | Introduction → last position |
| 3 | Delete the pricing slide | **Ask which** (Overview vs Details). Do not delete both |
| 4 | Move Pricing Details right after the Introduction | Unique title, just do it |
| 5 | Rename the last item to "Closing" | Last in current order, not "the original last item" |
| 6 | Change the description of Next Steps to "Owners, timeline, and budget sign-off." | `update_item` on that row |
| 7 | Add a slide about implementation risks before Next Steps | `add_item` at Next Steps' position |
| 8 | Move Competitive Analysis to the top and rename it to "Competitive Position" | `move_item` then `update_item` (or the other way) in one turn |
| 9 | Delete Market Landscape and Next Steps | One `delete_item` with two ids |
| 10 | Move the appendix to the top | **Nothing matches. Ask. Do not invent** |
| 11 | Start over with a new outline about our Q3 expansion into Southeast Asia | `create_outline`, nested model call, file replaced |

For #3 in the recording I answer "Pricing Overview" if asked. For #10 I say there isn't one / never mind, and continue to #11.

