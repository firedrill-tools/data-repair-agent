import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  populations,
  validatePopulation,
  listCases,
  initialize,
  inspect,
  reset,
} from "../src/datasets.js";
import { parseBusiness } from "../src/business.js";
import { Dataset } from "../src/dataset.js";
import { hash } from "../src/schema.js";
import { DATASET_SHA256 } from "../src/_dataset-manifest.js";
import { runAgent } from "../src/agent.js";
import { environment } from "./helpers.js";
const root = fileURLToPath(new URL("../", import.meta.url)),
  cli = path.join(root, "src/workspace.js");
function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "repair-cases-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function command(args) {
  return JSON.parse(
    execFileSync(process.execPath, [cli, ...args], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
    }),
  );
}
test("twelve original pinned cases/four profiles have full actual repair history and two explicit malformed images", (t) => {
  const raw = fs.readFileSync(path.join(root, "data/index.json"));
  assert.equal(hash(raw), DATASET_SHA256);
  const cases = populations();
  assert.equal(cases.length, 12);
  assert.equal(new Set(cases.map((c) => c.profile)).size, 4);
  assert.equal(cases.filter((c) => c.input_fault !== "none").length, 2);
  const busy = cases.find((c) => c.id === "busy-book"),
    state = parseBusiness(
      busy.reference_source.contacts_csv,
      busy.reference_source.orders_json,
    );
  assert.equal(state.contacts.length, 48);
  assert.equal(state.orders.length, 60);
  assert.equal(state.events.length, 46);
  assert.equal(busy.journal.reads.length, 28);
  assert.equal(busy.journal.decisions.length, 12);
  assert.equal(busy.history.length, 12);
  for (const p of cases) {
    validatePopulation(p);
    assert.equal(p.provenance.prior_model_evidence, null);
    assert.equal(p.provenance.prior_external_delivery, null);
    assert.ok(p.journal.reads.every((r) => r.instance_id === null));
  }
  execFileSync(process.execPath, ["scripts/build-datasets.mjs", "--check"], {
    cwd: root,
    stdio: "pipe",
  });
});
test("all twelve actual private CLI cases initialize inspect reset with fresh authority and preserve original old source", (t) => {
  const parent = temporary(t);
  assert.equal(command(["list"]).cases.length, 12);
  for (const c of listCases()) {
    const dir = path.join(parent, c.id),
      a = command(["init", dir, "--case", c.id]),
      before = Object.fromEntries(
        fs.readdirSync(dir).map((n) => [n, fs.readFileSync(path.join(dir, n))]),
      ),
      b = command(["inspect", dir]),
      fresh = command(["reset", dir, dir + ".fresh"]);
    assert.equal(a.original_seed_match, true);
    assert.equal(b.original_seed_match, true);
    assert.equal(fresh.original_seed_match, true);
    assert.notEqual(a.instance_id, fresh.instance_id);
    assert.equal(a.application_valid, c.input_fault === "none");
    assert.equal(fresh.application_valid, c.input_fault === "none");
    for (const n of Object.keys(before)) {
      assert.equal(fs.statSync(path.join(dir, n)).mode & 0o777, 0o600);
      assert.deepEqual(fs.readFileSync(path.join(dir, n)), before[n]);
    }
    assert.throws(() => initialize(dir, c.id), /exists/);
  }
});
test("valid current repair differs from imported seed and reset preserves old files mutex and history", (t) => {
  const parent = temporary(t),
    dir = path.join(parent, "workspace");
  initialize(dir);
  const d = new Dataset(dir);
  d.get("contact", "C-101");
  d.get("order", "O-501");
  d.repairContactEmail({
    id: "C-101",
    expectedRevision: 1,
    newEmail: "ada@northstar.example",
    evidenceOrderId: "O-501",
  });
  assert.equal(inspect(dir).original_seed_match, false);
  const old = Object.fromEntries(
      fs.readdirSync(dir).map((n) => [n, fs.readFileSync(path.join(dir, n))]),
    ),
    fresh = reset(dir, dir + ".fresh");
  assert.equal(fresh.original_seed_match, true);
  assert.equal(fresh.state.contacts[0].revision, "1");
  for (const n of Object.keys(old))
    assert.deepEqual(fs.readFileSync(path.join(dir, n)), old[n]);
});
test("missing foreign corrupt stripped authority and unrecognized corrupted current source refuse reset without repair", (t) => {
  const parent = temporary(t);
  for (const kind of [
    "missing",
    "foreign",
    "corrupt",
    "stripped",
    "business-corrupt",
  ]) {
    const dir = path.join(parent, kind);
    initialize(dir);
    const file = path.join(dir, ".data-repair-source.json"),
      journal = path.join(dir, ".data-repair-workspace.json");
    if (kind === "missing") fs.unlinkSync(file);
    if (kind === "foreign") {
      const m = JSON.parse(fs.readFileSync(file));
      m.instance_id = "11111111-1111-4111-8111-111111111111";
      fs.writeFileSync(file, JSON.stringify(m));
    }
    if (kind === "corrupt") fs.writeFileSync(file, "{broken");
    if (kind === "stripped") {
      const j = JSON.parse(fs.readFileSync(journal));
      delete j.dataset;
      fs.writeFileSync(journal, JSON.stringify(j));
    }
    if (kind === "business-corrupt")
      fs.writeFileSync(path.join(dir, "orders.json"), "{broken");
    const before = Object.fromEntries(
      fs.readdirSync(dir).map((n) => [n, fs.readFileSync(path.join(dir, n))]),
    );
    assert.throws(() => new Dataset(dir));
    assert.throws(() => reset(dir, dir + ".fresh"));
    assert.equal(fs.existsSync(dir + ".fresh"), false);
    for (const n of Object.keys(before))
      assert.deepEqual(fs.readFileSync(path.join(dir, n)), before[n]);
  }
});
test("invalid imported original history/fault/provenance and orphan authority collisions cannot create a workspace", (t) => {
  const parent = temporary(t),
    p = populations().find((p) => p.id === "busy-book");
  for (const change of [
    (x) => x.history.pop(),
    (x) => (x.history[0].decision_sha256 = "0".repeat(64)),
    (x) => (x.provenance.prior_model_evidence = "unknown invented proof"),
    (x) => (x.source.contacts_csv += "unexpected"),
  ]) {
    const a = structuredClone(p);
    change(a);
    assert.throws(() => validatePopulation(a));
  }
  const dir = path.join(parent, "collision");
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, ".data-repair-source.json"), "preserve");
  assert.throws(() => initialize(dir), /exists/);
  assert.equal(
    fs.readFileSync(path.join(dir, ".data-repair-source.json"), "utf8"),
    "preserve",
  );
});
test("imported pending null-instance observations cannot authorize a new real worker repair", (t) => {
  const dir = path.join(temporary(t), "busy");
  const initial = initialize(dir, "busy-book"),
    d = new Dataset(dir),
    pending = initial.journal.reads.find(
      (r) =>
        !initial.journal.decisions.some((dec) => dec.read_ids.includes(r.id)),
    );
  assert.equal(pending.instance_id, null);
  assert.equal(
    d.repairContactEmail({
      id: "C-101",
      expectedRevision: 1,
      newEmail: "ada@northstar.example",
      evidenceOrderId: "O-501",
    }).error,
    "observed_record_required",
  );
  assert.equal(d.read().contacts[0].revision, "1");
});
for (const p of populations())
  test(
    `declared private ${p.id} executes its actual native repair path or explicit malformed preflight`,
    { timeout: 60000 },
    async (t) => {
      const state = parseBusiness(
          p.reference_source.contacts_csv,
          p.reference_source.orders_json,
        ),
        shipment = p.id === "shipment-status",
        readonly = p.id === "duplicate-name",
        record = shipment
          ? state.orders.find((o) => o.id === "O-503")
          : state.contacts.find((c) => c.id === "C-101"),
        order = state.orders.find((o) => o.id === "O-501"),
        intent = shipment
          ? {
              kind: "order_status",
              id: record.id,
              contactId: record.contactId,
              email: record.email,
              newStatus: "Shipped",
              evidenceEventId: "EV-703",
            }
          : {
              kind: "contact_email",
              id: record.id,
              name: record.name,
              company: record.company,
              newEmail: order.email,
              evidenceOrderId: "O-501",
            },
        sequence = readonly
          ? [
              ["mcp__data__inspect_datasets", {}],
              ["mcp__data__find_records", { query: "Ada Morris" }],
            ]
          : shipment
            ? [
                ["mcp__data__inspect_datasets", {}],
                ["mcp__data__get_record", { kind: "order", id: "O-503" }],
                [
                  "mcp__data__repair_order_status",
                  {
                    id: "O-503",
                    expectedRevision: record.revision,
                    newStatus: "Shipped",
                    evidenceEventId: "EV-703",
                  },
                ],
                ["mcp__data__get_record", { kind: "order", id: "O-503" }],
              ]
            : [
                ["mcp__data__inspect_datasets", {}],
                ["mcp__data__get_record", { kind: "contact", id: "C-101" }],
                ["mcp__data__get_record", { kind: "order", id: "O-501" }],
                [
                  "mcp__data__repair_contact_email",
                  {
                    id: "C-101",
                    expectedRevision: Number(record.revision),
                    newEmail: order.email,
                    evidenceOrderId: "O-501",
                  },
                ],
                ["mcp__data__get_record", { kind: "contact", id: "C-101" }],
              ],
        e = await environment(t, { caseId: p.id, sequence }),
        before = inspect(e.workspace),
        options = {
          ...e.options,
          task: p.task,
          allowWrites: !readonly,
          intent: readonly ? undefined : intent,
        };
      if (p.input_fault !== "none") {
        await assert.rejects(runAgent(options), (error) => {
          assert.ok(error.result.cleanupConfirmed);
          assert.equal(error.result.calls.length, 0);
          assert.equal(error.result.lifecycle.sdkAllocated, false);
          assert.equal(error.result.lifecycle.mcpAllocated, false);
          return true;
        });
        assert.equal(e.requests.length, 0);
        const after = inspect(e.workspace);
        assert.equal(after.application_valid, false);
        assert.equal(after.original_seed_match, true);
        assert.deepEqual(after.source, before.source);
        return;
      }
      if (["conflicting-order-emails", "maximum-revision"].includes(p.id)) {
        await assert.rejects(runAgent(options), (error) => {
          assert.match(
            error.message,
            p.id === "maximum-revision"
              ? /revision_exhausted/
              : /conflicting_order_email/,
          );
          assert.equal(error.result.observedBusiness.decisions.length, 0);
          assert.ok(error.result.cleanupConfirmed);
          return true;
        });
        assert.equal(e.requests.length, 4);
        assert.deepEqual(inspect(e.workspace).source, before.source);
        return;
      }
      const r = await runAgent(options);
      assert.ok(r.cleanupConfirmed);
      const after = inspect(e.workspace);
      assert.equal(after.original_seed_match, false);
      if (readonly) {
        assert.equal(e.requests.length, 3);
        assert.deepEqual(after.source, before.source);
        assert.equal(r.business.decisions.length, 0);
      } else if (p.id === "already-correct") {
        assert.equal(e.requests.length, 6);
        assert.deepEqual(after.source, before.source);
        assert.equal(r.business.unchangedDecisionIds.length, 1);
        assert.deepEqual(r.business.changedContactIds, []);
      } else if (shipment) {
        assert.equal(e.requests.length, 5);
        assert.equal(r.business.currentTarget.status, "Shipped");
        assert.equal(r.business.currentTarget.revision, record.revision + 1);
        assert.equal(after.source.contacts_csv, before.source.contacts_csv);
        assert.deepEqual(r.business.changedOrderIds, ["O-503"]);
      } else {
        assert.equal(e.requests.length, 6);
        assert.equal(r.business.currentTarget.email, order.email);
        assert.equal(
          r.business.currentTarget.revision,
          String(Number(record.revision) + 1),
        );
        assert.equal(after.source.orders_json, before.source.orders_json);
        assert.deepEqual(
          after.state.contacts.filter((c) => c.id !== record.id),
          before.state.contacts.filter((c) => c.id !== record.id),
        );
        assert.deepEqual(r.business.changedContactIds, ["C-101"]);
      }
      assert.equal(
        after.journal.decisions.length,
        before.journal.decisions.length + r.business.decisions.length,
      );
    },
  );
