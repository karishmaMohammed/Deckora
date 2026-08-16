import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { config } from "./config.ts";
import { usageLogHandler } from "./usageLog.ts";

export type ChatModel = ChatAnthropic | ChatOpenAI;

export function createChatModel(options?: { temperature?: number }): ChatModel {
  const temperature = options?.temperature ?? 0;

  if (config.provider === "anthropic") {
    return new ChatAnthropic({
      model: config.modelName,
      apiKey: config.anthropicApiKey,
      temperature,
      callbacks: [usageLogHandler],
    });
  }

  return new ChatOpenAI({
    model: config.modelName,
    apiKey: config.openaiApiKey,
    temperature,
    callbacks: [usageLogHandler],
    ...(config.baseUrl
      ? {
          useResponsesApi: false,
          configuration: { baseURL: config.baseUrl },
        }
      : {}),
  });
}

export function modelLabel(): string {
  return `${config.provider}:${config.modelName}`;
}
