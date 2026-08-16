import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { LLMResult } from "@langchain/core/outputs";
import { config } from "./config.ts";

/** Mid-market USD/INR around 15 Aug 2026. Override with USD_INR in .env. */
const USD_INR = Number(process.env.USD_INR ?? 95.5);

type UsdPerMillion = { input: number; output: number };

function rates(): UsdPerMillion {
  const model = config.modelName.toLowerCase();
  if (config.provider === "anthropic") {
    if (model.includes("haiku")) return { input: 1, output: 5 };
    if (model.includes("opus")) return { input: 15, output: 75 };
    return { input: 3, output: 15 };
  }
  if (model.includes("4o-mini") || model.includes("4.1-mini") || model.includes("gpt-4.1-nano")) {
    return { input: 0.15, output: 0.6 };
  }
  return { input: 2.5, output: 10 };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function num(...values: unknown[]): number {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return 0;
}

function extractTokens(output: LLMResult): { input: number; output: number } {
  const llm = asRecord(output.llmOutput);
  const tokenUsage = asRecord(llm?.tokenUsage);
  const usage = asRecord(llm?.usage);
  const first = output.generations?.[0]?.[0];
  const message = first && "message" in first ? asRecord((first as { message?: unknown }).message) : undefined;
  const usageMeta = asRecord(message?.usage_metadata);
  const responseMeta = asRecord(message?.response_metadata);
  const responseUsage = asRecord(responseMeta?.usage);

  return {
    input: num(
      usageMeta?.input_tokens,
      tokenUsage?.promptTokens,
      tokenUsage?.input_tokens,
      usage?.input_tokens,
      usage?.prompt_tokens,
      responseUsage?.input_tokens,
    ),
    output: num(
      usageMeta?.output_tokens,
      tokenUsage?.completionTokens,
      tokenUsage?.output_tokens,
      usage?.output_tokens,
      usage?.completion_tokens,
      responseUsage?.output_tokens,
    ),
  };
}

function formatInr(usd: number): string {
  const inr = usd * USD_INR;
  return `$${usd.toFixed(4)}  ₹${inr.toFixed(2)}`;
}

function costUsd(inputTokens: number, outputTokens: number): number {
  const rate = rates();
  return (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000;
}

type Totals = { hits: number; input: number; output: number };

const session: Totals = { hits: 0, input: 0, output: 0 };
let turn: Totals | null = null;
let nextHit = 0;

function add(totals: Totals, input: number, output: number): void {
  totals.hits += 1;
  totals.input += input;
  totals.output += output;
}

function printLine(label: string, hits: number, input: number, output: number): void {
  const usd = costUsd(input, output);
  const usage = input === 0 && output === 0 ? "tokens not reported" : `in=${input} out=${output}`;
  console.log(`[llm] ${label}  hits=${hits}  ${usage}  ${formatInr(usd)}`);
}

export function beginChatTurn(userMessage: string): void {
  nextHit = 0;
  turn = { hits: 0, input: 0, output: 0 };
  const preview = userMessage.length > 90 ? `${userMessage.slice(0, 90)}…` : userMessage;
  console.log(`\n=== chat turn ===`);
  console.log(`[llm] user: ${preview}`);
}

export function endChatTurn(): void {
  if (!turn) return;
  printLine("turn total", turn.hits, turn.input, turn.output);
  printLine("session total", session.hits, session.input, session.output);
  turn = null;
}

export class UsageLogHandler extends BaseCallbackHandler {
  name = "UsageLogHandler";

  override handleLLMStart(): void {
    nextHit += 1;
    console.log(`[llm] hit ${nextHit} start  ${config.provider}:${config.modelName}`);
  }

  override async handleLLMEnd(output: LLMResult): Promise<void> {
    const tokens = extractTokens(output);
    if (turn) add(turn, tokens.input, tokens.output);
    add(session, tokens.input, tokens.output);
    const usd = costUsd(tokens.input, tokens.output);
    const usage =
      tokens.input === 0 && tokens.output === 0
        ? "tokens not reported"
        : `in=${tokens.input} out=${tokens.output}`;
    console.log(`[llm] hit ${nextHit} done   ${usage}  ${formatInr(usd)}`);
  }

  override handleLLMError(err: Error): void {
    console.warn(`[llm] hit ${nextHit} failed  ${err.message}`);
  }
}

export const usageLogHandler = new UsageLogHandler();
