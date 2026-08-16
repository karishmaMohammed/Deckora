import cors from "cors";
import express from "express";
import { getAgentLabel } from "./agent.ts";
import { config } from "./config.ts";
import { readOutline, resetOutlineFromSeed, withPositions } from "./outlineStore.ts";
import { streamAgentTurn } from "./stream.ts";
import { beginChatTurn, endChatTurn } from "./usageLog.ts";

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, model: getAgentLabel() });
});

app.get("/api/outline", async (_req, res) => {
  try {
    const outline = await readOutline();
    res.json({ items: withPositions(outline.items) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to read outline";
    res.status(500).json({ error: message });
  }
});

app.post("/api/outline/reset", async (_req, res) => {
  try {
    const outline = await resetOutlineFromSeed();
    res.json({ items: withPositions(outline.items) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to reset outline";
    res.status(500).json({ error: message });
  }
});

app.post("/api/chat", async (req, res) => {
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  const threadId =
    typeof req.body?.threadId === "string" && req.body.threadId.trim()
      ? req.body.threadId.trim()
      : crypto.randomUUID();

  if (!message) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  beginChatTurn(message);
  try {
    for await (const event of streamAgentTurn(message, threadId)) {
      send(event.type, event);
      if (event.type === "done" || event.type === "error") break;
    }
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "Agent failed";
    send("error", { type: "error", message: messageText });
  } finally {
    endChatTurn();
    res.end();
  }
});

app.listen(config.port, () => {
  console.log(`Backend listening on http://127.0.0.1:${config.port}`);
  console.log(`Model: ${getAgentLabel()}`);
});
