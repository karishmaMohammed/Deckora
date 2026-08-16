import { createDeepAgent, registerHarnessProfile } from "deepagents";
import { MemorySaver } from "@langchain/langgraph";
import { createChatModel, modelLabel } from "./model.ts";
import { SYSTEM_PROMPT } from "./prompt.ts";
import { outlineTools } from "./tools.ts";

const HIDDEN_HARNESS_TOOLS = [
  "ls",
  "read_file",
  "write_file",
  "edit_file",
  "glob",
  "grep",
  "execute",
  "write_todos",
  "task",
] as const;

/**
 * DeepAgents ships filesystem / todo / subagent tools. The spec is six tools
 * and no seventh, so hide the harness extras. Lookup uses the model provider key.
 */
function hideHarnessTools(): void {
  const profile = {
    excludedTools: [...HIDDEN_HARNESS_TOOLS],
    generalPurposeSubagent: { enabled: false },
  };
  for (const key of ["anthropic", "openai"] as const) {
    try {
      registerHarnessProfile(key, profile);
    } catch (error) {
      console.warn(`Could not register harness profile for ${key}:`, error);
    }
  }
}

hideHarnessTools();

const checkpointer = new MemorySaver();
const model = createChatModel({ temperature: 0 });

const agent = await Promise.resolve(
  createDeepAgent({
    model,
    tools: outlineTools,
    systemPrompt: SYSTEM_PROMPT,
    checkpointer,
    name: "deckora",
  }),
);

export function getAgent() {
  return agent;
}

export function getAgentLabel(): string {
  return modelLabel();
}
