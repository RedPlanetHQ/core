import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { generateText } from "ai";
import { createOllama } from "ollama-ai-provider-v2";
import { OLLAMA_NUM_CTX } from "../promptBudget";

/**
 * Wire-level proof that the output-token limit reaches Ollama.
 *
 * Core passed `maxTokens: 500` for the reranker and it had no effect. There were
 * two layers to that bug: makeModelCall never forwarded its `options`, AND
 * ollama-ai-provider-v2 maps the AI SDK's `maxOutputTokens` onto a JSON field
 * named `max_output_tokens`, which Ollama's /api/chat does not recognise and
 * silently ignores. The only field Ollama honours is `options.num_predict`.
 *
 * These tests assert on the actual bytes sent to a fake Ollama, so the claim is
 * verified rather than assumed.
 */

let server: http.Server;
let baseURL: string;
const captured: Array<Record<string, any>> = [];

function ollamaChatResponse() {
  return JSON.stringify({
    model: "qwen3:8b",
    created_at: new Date().toISOString(),
    message: { role: "assistant", content: "ok" },
    done: true,
    done_reason: "stop",
    prompt_eval_count: 10,
    eval_count: 2,
  });
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        captured.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        captured.push({ __unparseable: true });
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(ollamaChatResponse());
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  baseURL = `http://127.0.0.1:${port}/api`;
});

afterAll(async () => {
  // Always tear down, even if an assertion above failed, so the run cannot hang.
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function callOllama(callOptions: Record<string, any>) {
  captured.length = 0;
  const ollama = createOllama({ baseURL });
  await generateText({
    model: ollama("qwen3:8b") as any,
    messages: [{ role: "user", content: "hi" }],
    ...callOptions,
  });
  expect(captured).toHaveLength(1);
  return captured[0];
}

describe("Ollama provider options channel", () => {
  it("delivers num_ctx and num_predict via providerOptions.ollama.options", async () => {
    const body = await callOllama({
      providerOptions: {
        ollama: { options: { num_ctx: OLLAMA_NUM_CTX, num_predict: 500 } },
      },
    });

    expect(body.options).toBeDefined();
    expect(body.options.num_ctx).toBe(4096);
    expect(body.options.num_predict).toBe(500);
  });

  it("does NOT produce an Ollama-honoured limit from maxOutputTokens alone", async () => {
    const body = await callOllama({ maxOutputTokens: 500 });

    // This is the trap: it looks set, but Ollama ignores max_output_tokens.
    expect(body.options?.num_predict).toBeUndefined();
  });

  it("sends no options block at all when neither channel is used", async () => {
    const body = await callOllama({});
    expect(body.options).toBeUndefined();
  });
});
