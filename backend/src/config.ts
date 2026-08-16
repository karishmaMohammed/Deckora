import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(backendDir, "..");

dotenv.config({ path: path.join(repoRoot, ".env") });
dotenv.config({ path: path.join(backendDir, ".env") });

export type LlmProvider = "anthropic" | "openai";

const DEFAULT_MODEL: Record<LlmProvider, string> = {
  anthropic: "claude-sonnet-4-5",
  openai: "gpt-4o-mini",
};

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function inferProvider(): LlmProvider {
  const explicit = process.env.LLM_PROVIDER?.trim().toLowerCase();
  if (explicit === "anthropic" || explicit === "openai") return explicit;
  if (explicit) {
    throw new Error(`Unknown LLM_PROVIDER "${process.env.LLM_PROVIDER}". Use anthropic or openai.`);
  }
  if (env("ANTHROPIC_API_KEY")) return "anthropic";
  if (env("OPENAI_API_KEY")) return "openai";
  return "anthropic";
}

const provider = inferProvider();

export const config = {
  port: Number(process.env.PORT ?? 3001),
  outlinePath: process.env.OUTLINE_PATH
    ? path.resolve(process.env.OUTLINE_PATH)
    : path.join(backendDir, "data", "outline.json"),
  seedPath: path.join(backendDir, "data", "outline.seed.json"),
  provider,
  modelName: env("LLM_MODEL") ?? DEFAULT_MODEL[provider],
  baseUrl: env("LLM_BASE_URL"),
  anthropicApiKey: env("ANTHROPIC_API_KEY"),
  openaiApiKey: env("OPENAI_API_KEY"),
} as const;

export function assertApiKeyPresent(): void {
  if (config.provider === "anthropic") {
    if (!config.anthropicApiKey) {
      throw new Error(
        "Missing ANTHROPIC_API_KEY. Copy .env.example to .env and fill in the key, or set LLM_PROVIDER=openai with OPENAI_API_KEY.",
      );
    }
    return;
  }

  if (!config.openaiApiKey) {
    throw new Error(
      "Missing OPENAI_API_KEY. Copy .env.example to .env and fill in the key, or set LLM_PROVIDER=anthropic with ANTHROPIC_API_KEY.",
    );
  }
}
