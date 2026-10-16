import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { initializeManaged } from "../src/managed.js";
import { Dataset } from "../src/dataset.js";
import { initialize as initializeCase } from "../src/datasets.js";
export const intent = {
  kind: "contact_email",
  id: "C-101",
  name: "Ada Morris",
  company: "Northstar",
  newEmail: "ada@northstar.example",
  evidenceOrderId: "O-501",
};
export const actions = [
  ["mcp__data__inspect_datasets", {}],
  ["mcp__data__get_record", { kind: "contact", id: "C-101" }],
  ["mcp__data__get_record", { kind: "order", id: "O-501" }],
  [
    "mcp__data__repair_contact_email",
    {
      id: "C-101",
      expectedRevision: 1,
      newEmail: "ada@northstar.example",
      evidenceOrderId: "O-501",
    },
  ],
  ["mcp__data__get_record", { kind: "contact", id: "C-101" }],
];
export async function environment(
  t,
  { sequence = actions, mutate = (frames) => frames, caseId } = {},
) {
  const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "data-owned-runtime-"),
    ),
    workspace = path.join(directory, "workspace");
  const initialized = caseId
    ? initializeCase(workspace, caseId)
    : initializeManaged(workspace);
  let dataset;
  try {
    dataset = new Dataset(workspace);
  } catch (e) {
    if (initialized.application_valid !== false) throw e;
    dataset = null;
  }
  const requests = [];
  const provider = createServer(async (req, res) => {
    try {
      let raw = "";
      for await (const b of req) raw += b;
      const body = JSON.parse(raw);
      requests.push(body);
      assert.equal(req.url, "/v1/messages?beta=true");
      assert.equal(req.headers["x-api-key"], "synthetic-data-owned-key");
      assert.equal(body.model, "claude-sonnet-4-6");
      assert.equal(body.max_tokens, 4096);
      assert.equal(body.thinking.type, "disabled");
      assert.equal(body.tools.length, 5);
      const n =
          body.messages
            .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
            .filter((c) => c.type === "tool_result").length + 1,
        action = sequence[n - 1],
        block = action
          ? {
              type: "tool_use",
              id: "original-call-" + n,
              name: action[0],
              input: {},
            }
          : { type: "text", text: "" },
        frames = [
          {
            type: "message_start",
            message: {
              id: "msg-" + n,
              type: "message",
              role: "assistant",
              model: body.model,
              content: [],
              stop_reason: null,
              usage: { input_tokens: 10 },
              unknown_original: true,
            },
          },
          { type: "content_block_start", index: 0, content_block: block },
          {
            type: "content_block_delta",
            index: 0,
            delta: action
              ? {
                  type: "input_json_delta",
                  partial_json: JSON.stringify(action[1]),
                }
              : {
                  type: "text_delta",
                  text: "The exact current synthetic record was inspected and verified.",
                },
          },
          { type: "content_block_stop", index: 0 },
          {
            type: "message_delta",
            delta: {
              stop_reason: action ? "tool_use" : "end_turn",
              stop_sequence: null,
            },
            usage: { output_tokens: 2 },
          },
          { type: "message_stop" },
        ],
        changed = await mutate(frames, n, { dataset, workspace, body, res });
      if (res.writableEnded || res.destroyed) return;
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "request-id": "request-" + n,
      });
      res.end(
        changed
          .map((f) => `event: ${f.type}\ndata: ${JSON.stringify(f)}\n\n`)
          .join(""),
      );
    } catch (e) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: e.message } }));
    }
  });
  provider.listen(0, "127.0.0.1");
  await once(provider, "listening");
  t.after(async () => {
    provider.closeAllConnections();
    await new Promise((r) => provider.close(r));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return {
    directory,
    workspace,
    dataset,
    requests,
    options: {
      workspace,
      task: "Inspect exact C-101 contact and O-501 order, repair only the email to ada@northstar.example, reread and verify.",
      model: "claude-sonnet-4-6",
      apiKey: "synthetic-data-owned-key",
      baseUrl: `http://127.0.0.1:${provider.address().port}`,
      outputRoot: directory,
      allowWrites: true,
      intent,
    },
  };
}
