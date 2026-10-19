/** Fresh locked complete source and production-only CLI/native/browser proof. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import assert from "node:assert/strict";
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url))),
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "repair-distribution-")),
  env = { ...process.env };
for (const k of Object.keys(env))
  if (
    [
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_BASE_URL",
      "CLAUDE_MODEL",
      "CLAUDE_CONFIG_DIR",
      "DATA_REPAIR_OPERATION_CREDENTIAL",
      "DATA_REPAIR_OPERATION_ID",
      "PORT",
      "NODE_PATH",
      "NODE_OPTIONS",
      "NODE_TEST_CONTEXT",
    ].includes(k) ||
    k.toLowerCase() === "npm_config_allow_scripts"
  )
    delete env[k];
const hash = (b) => createHash("sha256").update(b).digest("hex"),
  run = (cmd, args, cwd = temporary) =>
    execFileSync(cmd, args, {
      cwd,
      env,
      encoding: "utf8",
      timeout: 240000,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
const children = new Set();
let provider, portal;
function within(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
function child(args, extra = {}) {
  const processChild = spawn(process.execPath, args, {
    cwd: temporary,
    env: { ...env, ...extra },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "",
    err = "";
  processChild.stdout.on("data", (b) => (out += b));
  processChild.stderr.on("data", (b) => (err += b));
  const done = new Promise((resolve, reject) => {
    processChild.once("error", reject);
    processChild.once("exit", (code, signal) =>
      resolve({ code, signal, out, err }),
    );
  });
  const entry = { process: processChild, done };
  children.add(entry);
  done.finally(() => children.delete(entry));
  return entry;
}
async function operator(cli, args, extra = {}) {
  const entry = child([cli, ...args], extra);
  return within(entry.done, 20000, "installed operator did not settle");
}
try {
  const source = JSON.parse(
      run(process.execPath, ["scripts/package.mjs"], root),
    ),
    repeat = path.join(temporary, "repeat.tar.gz");
  run(process.execPath, ["scripts/package.mjs", repeat], root);
  assert.deepEqual(fs.readFileSync(source.path), fs.readFileSync(repeat));
  run("tar", ["-xzf", source.path, "-C", temporary]);
  const directory = path.join(temporary, "package"),
    manifest = JSON.parse(
      fs.readFileSync(path.join(directory, "MANIFEST.json")),
    );
  const verify = () => {
    for (const row of manifest.files) {
      const file = path.join(directory, row.path),
        raw = fs.readFileSync(file);
      assert.equal(hash(raw), row.sha256, `delivered hash ${row.path}`);
      assert.equal(raw.length, row.size);
      assert.equal(fs.statSync(file).mode & 0o777, row.mode);
    }
  };
  const enumerated = [];
  function walk(file) {
    const stat = fs.lstatSync(file);
    assert.ok(!stat.isSymbolicLink());
    if (stat.isDirectory())
      for (const n of fs.readdirSync(file)) walk(path.join(file, n));
    else enumerated.push(path.relative(directory, file));
  }
  walk(directory);
  assert.deepEqual(
    enumerated.sort(),
    [...manifest.files.map((r) => r.path), "MANIFEST.json"].sort(),
  );
  verify();
  run("npm", ["ci", "--no-audit", "--no-fund"], directory);
  if(!fs.existsSync(path.join(directory,'firedrill/scenario.json'))||fs.existsSync(path.join(directory,'firedrill/node_modules')))throw new Error('archive integration boundary differs');
  run('npm',['ci','--prefix','firedrill','--ignore-scripts','--no-audit','--no-fund'],directory);
  run('npm',['test','--prefix','firedrill'],directory);

  const suite = run("npm", ["test"], directory);
  fs.mkdirSync(path.join(root, "dist"), { recursive: true });
  fs.writeFileSync(path.join(root, "dist/fresh-tests.log"), suite);
  assert.match(suite, /tests\s+92\b/);
  assert.match(suite, /fail\s+0\b/);
  console.log("Fresh locked complete source: 92 checks passed");
  run(process.execPath, ["scripts/build-datasets.mjs", "--check"], directory);
  const production = path.join(temporary, "production");
  fs.mkdirSync(production);
  for (const name of [
    "src",
    "data",
    "fixtures",
    "package.json",
    "package-lock.json",
    "README.md",
    "AGENTS.md",
  ])
    fs.cpSync(path.join(directory, name), path.join(production, name), {
      recursive: true,
    });
  run("npm", ["ci", "--omit=dev", "--no-audit", "--no-fund"], production);
  const cli = path.join(production, "src/agent.js"),
    workspace = path.join(production, "src/workspace.js");
  assert.match(run(process.execPath, [cli, "--help"]), /data-repair/);
  assert.match(run(process.execPath, [workspace, "--help"]), /data-workspace/);
  const agentAlias = path.join(temporary, "agent-alias.js"),
    workspaceAlias = path.join(temporary, "workspace-alias.js");
  fs.symlinkSync(cli, agentAlias);
  fs.symlinkSync(workspace, workspaceAlias);
  const cases = JSON.parse(
    run(process.execPath, [workspaceAlias, "list"]),
  ).cases;
  assert.equal(cases.length, 12);
  for (const c of cases) {
    const dir = path.join(temporary, c.id),
      first = JSON.parse(
        run(process.execPath, [workspaceAlias, "init", dir, "--case", c.id]),
      ),
      before = Object.fromEntries(
        fs.readdirSync(dir).map((n) => [n, fs.readFileSync(path.join(dir, n))]),
      ),
      read = JSON.parse(run(process.execPath, [workspace, "inspect", dir])),
      fresh = JSON.parse(
        run(process.execPath, [workspace, "reset", dir, dir + ".fresh"]),
      );
    assert.equal(read.original_seed_match, true);
    assert.equal(read.application_valid, c.input_fault === "none");
    assert.equal(fresh.application_valid, c.input_fault === "none");
    assert.equal(fresh.original_seed_match, true);
    assert.notEqual(first.instance_id, fresh.instance_id);
    for (const n of Object.keys(before)) {
      assert.deepEqual(fs.readFileSync(path.join(dir, n)), before[n]);
      assert.equal(fs.statSync(path.join(dir, n)).mode & 0o777, 0o600);
    }
  }
  console.log(
    "Production-only install: all 12 private CLI cases/read/reset, including two declared malformed images, passed",
  );
  const requests = [],
    actions = [
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
  let pendingControl = null,
    faultFinal = false;
  provider = createServer(async (req, res) => {
    try {
      let raw = "";
      for await (const b of req) raw += b;
      const body = JSON.parse(raw);
      requests.push(body);
      assert.equal(req.url, "/v1/messages?beta=true");
      assert.equal(req.headers["x-api-key"], "synthetic-installed-key");
      assert.equal(body.model, "claude-sonnet-4-6");
      assert.equal(body.max_tokens, 4096);
      assert.equal(body.thinking.type, "disabled");
      assert.equal(body.tools.length, 5);
      if (pendingControl) {
        pendingControl.entered();
        await pendingControl.held;
      }
      if (res.destroyed) return;
      const n =
          body.messages
            .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
            .filter((c) => c.type === "tool_result").length + 1,
        action = actions[n - 1],
        events = [
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
          {
            type: "content_block_start",
            index: 0,
            content_block: action
              ? {
                  type: "tool_use",
                  id: "original-call-" + n,
                  name: action[0],
                  input: {},
                }
              : { type: "text", text: "" },
          },
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
                  text: "The exact synthetic contact was repaired and reread.",
                },
          },
          { type: "content_block_stop", index: 0 },
          {
            type: "message_delta",
            delta: {
              stop_reason:
                faultFinal && n === 6
                  ? "max_tokens"
                  : action
                    ? "tool_use"
                    : "end_turn",
              stop_sequence: null,
            },
            usage: { output_tokens: 2 },
          },
          { type: "message_stop" },
        ];
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "request-id": "request-" + requests.length,
      });
      res.end(
        events
          .map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
          .join(""),
      );
    } catch (e) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: e.message } }));
    }
  });
  provider.listen(0, "127.0.0.1");
  await once(provider, "listening");
  const base = `http://127.0.0.1:${provider.address().port}`,
    common = ["--model", "claude-sonnet-4-6", "--base-url", base],
    rootWorkspace = path.join(temporary, "corrected-contact"),
    intent = {
      kind: "contact_email",
      id: "C-101",
      name: "Ada Morris",
      company: "Northstar",
      newEmail: "ada@northstar.example",
      evidenceOrderId: "O-501",
    },
    task =
      "Read exact C-101 and O-501, correct only the contact email to ada@northstar.example, then reread and verify.",
    normalRoot = path.join(temporary, "normal-receipts");
  const normal = await operator(
    agentAlias,
    [
      ...common,
      "--workspace",
      rootWorkspace,
      "--allow-writes",
      "--intent-json",
      JSON.stringify(intent),
      "--task",
      task,
      "--output",
      normalRoot,
    ],
    { ANTHROPIC_API_KEY: "synthetic-installed-key" },
  );
  assert.equal(normal.code, 0, normal.err + normal.out);
  const output = JSON.parse(normal.out);
  assert.equal(requests.length, 6);
  assert.deepEqual(output.business.changedContactIds, ["C-101"]);
  assert.equal(output.business.currentTarget.revision, "2");
  assert.equal(output.business.currentTarget.email, "ada@northstar.example");
  assert.equal(output.costUsd, null);
  assert.equal(output.usage.input.value, 60);
  const trace = JSON.parse(fs.readFileSync(output.receiptPath));
  assert.equal(trace.cleanupConfirmed, true);
  assert.equal(trace.actions.length, 5);
  assert.equal(trace.calls.length, 6);
  assert.ok(
    trace.calls.every(
      (c) =>
        c.response.events[0].message.unknown_original &&
        c.reportedUsage.input.value === 10,
    ),
  );
  assert.ok(trace.mcp.pid > 0);
  assert.equal(trace.sdkSubprocessExits.length, 1);
  assert.equal(trace.sdkSubprocessExits[0].code, 0);
  assert.equal(trace.finalSource.journal.operations.at(-1).status, "closed");
  assert.ok(!JSON.stringify(trace).includes("synthetic-installed-key"));
  const missingRoot = path.join(temporary, "missing-receipts"),
    missing = await operator(cli, [
      ...common,
      "--workspace",
      rootWorkspace,
      "--task",
      "Inspect the current synthetic datasets",
      "--output",
      missingRoot,
    ]);
  assert.equal(missing.code, 1, missing.err + missing.out);
  const missingOutput = JSON.parse(missing.out);
  assert.equal(missingOutput.cleanupConfirmed, true);
  assert.equal(missingOutput.usage.input.value, null);
  assert.equal(requests.length, 6);
  assert.equal(
    JSON.parse(
      fs.readFileSync(path.join(missingOutput.outputDir, "trace.json")),
    ).calls.length,
    0,
  );
  for (const osSignal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    let entered, release;
    const pending = new Promise((r) => (entered = r)),
      held = new Promise((r) => (release = r));
    pendingControl = { entered, held };
    const entry = child(
      [
        cli,
        ...common,
        "--workspace",
        rootWorkspace,
        "--task",
        "Inspect synthetic datasets",
        "--output",
        path.join(temporary, osSignal + "-receipts"),
      ],
      { ANTHROPIC_API_KEY: "synthetic-installed-key" },
    );
    try {
      await within(
        Promise.race([
          pending,
          entry.done.then((r) => {
            throw Error("signal CLI exited early: " + r.out + r.err);
          }),
        ]),
        10000,
        "installed actual native HTTP not reached",
      );
      entry.process.kill(osSignal);
      const stopped = await within(
        entry.done,
        10000,
        "installed CLI did not drain",
      );
      assert.equal(stopped.code, 1, stopped.err + stopped.out);
      const value = JSON.parse(stopped.out);
      assert.equal(value.cleanupConfirmed, true);
      assert.match(value.error, new RegExp(osSignal));
      assert.equal(value.usage.input.value, null);
    } finally {
      release();
      pendingControl = null;
    }
  }
  assert.equal(requests.length, 9);
  const current = JSON.parse(
    run(process.execPath, [workspace, "inspect", rootWorkspace]),
  );
  assert.equal(current.state.contacts[0].revision, "2");
  assert.equal(current.journal.decisions.length, 1);
  assert.ok(current.journal.operations.every((o) => o.status === "closed"));
  const partialWorkspace = path.join(temporary, "partial-workspace");
  run(process.execPath, [workspace, "init", partialWorkspace]);
  faultFinal = true;
  const partial = await operator(
    cli,
    [
      ...common,
      "--workspace",
      partialWorkspace,
      "--allow-writes",
      "--intent-json",
      JSON.stringify(intent),
      "--task",
      task,
      "--output",
      path.join(temporary, "partial-receipts"),
    ],
    { ANTHROPIC_API_KEY: "synthetic-installed-key" },
  );
  assert.equal(partial.code, 1, partial.err + partial.out);
  const value = JSON.parse(partial.out);
  assert.equal(value.cleanupConfirmed, true);
  assert.match(value.error, /unfinished/);
  assert.deepEqual(value.business.changedContactIds, ["C-101"]);
  assert.equal(value.business.currentTarget.revision, "2");
  assert.equal(value.business.decisions[0].status, "applied");
  assert.equal(value.usage.input.value, 60);
  assert.equal(requests.length, 15);
  console.log(
    "Installed normal symlink CLI/actual Claude SDK/native SSE/real scoped stdio worker, missing key, all three signals and partial native failure after committed repair passed",
  );
  verify();
  const rebuilt = path.join(temporary, "rebuilt.tar.gz");
  run(process.execPath, ["scripts/package.mjs", rebuilt], directory);
  assert.deepEqual(fs.readFileSync(source.path), fs.readFileSync(rebuilt));
  const report = {
    ...source,
    checks:
      "fresh locked complete source/production-only dependencies outside checkout;92source/native/real scoped stdio/CLI/dataset checks;12private case init/inspect/reset (10actual native paths and2explicit malformed preflight cases);normal installed symlink Claude SDK/native SSE/public hook/real owned worker/exact repair;missing-key prepared evidence;all SIGINT SIGTERM SIGHUP pending native HTTP drains;partial actual commit with final native failure;unchanged delivered manifest/repeated portable USTAR gzip bytes",
  };
  fs.writeFileSync(
    path.join(root, "dist/qualification.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} finally {
  for (const e of children) {
    e.process.kill("SIGKILL");
    await e.done.catch(() => {});
  }
  if (provider) {
    provider.closeAllConnections();
    await new Promise((r) => provider.close(r));
  }
  fs.rmSync(temporary, { recursive: true, force: true });
}
