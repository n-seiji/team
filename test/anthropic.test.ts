import { test } from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { AnthropicBackend } from "../src/backends/anthropic.ts";
const turn = { member: "pm", role: "pm", canEdit: false, system: "s", user: "u" };

async function replyTo(body: object) {
  const server = http.createServer((_req, res) => res.setHeader("content-type", "application/json").end(JSON.stringify(body)));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const saved = { key: process.env.ANTHROPIC_API_KEY, base: process.env.ANTHROPIC_BASE_URL };
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    return await new AnthropicBackend({ type: "anthropic" }).respond(turn);
  } finally {
    server.close();
    if (saved.key === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved.key;
    if (saved.base === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = saved.base;
  }
}

test("the Messages API's usage becomes the turn's tokens, with no invented cost", async () => {
  const reply = await replyTo({
    content: [{ type: "text", text: "[SAY to=all] hi" }],
    usage: { input_tokens: 11, output_tokens: 22, cache_creation_input_tokens: 33, cache_read_input_tokens: 44 },
  });
  assert.equal(reply.text, "[SAY to=all] hi");
  assert.deepEqual(reply.usage, { tokens: { input: 11, cacheWrite: 33, cacheRead: 44, output: 22 } });
});

test("cache fields the API leaves out stay out", async () => {
  const reply = await replyTo({ content: [{ type: "text", text: "x" }], usage: { input_tokens: 5, output_tokens: 6 } });
  assert.deepEqual(reply.usage, { tokens: { input: 5, output: 6 } });
});

test("a response without usage returns only the text", async () => {
  const reply = await replyTo({ content: [{ type: "text", text: "x" }] });
  assert.equal(reply.text, "x");
  assert.equal(reply.usage, undefined);
});
