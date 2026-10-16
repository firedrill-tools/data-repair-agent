import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Dataset } from "../src/dataset.js";
import { initializeManaged, JOURNAL } from "../src/managed.js";
import { hash } from "../src/schema.js";
const intent = {
    kind: "contact_email",
    id: "C-101",
    name: "Ada Morris",
    company: "Northstar",
    newEmail: "ada@northstar.example",
    evidenceOrderId: "O-501",
  },
  input = {
    id: "C-101",
    expectedRevision: 1,
    newEmail: "ada@northstar.example",
    evidenceOrderId: "O-501",
  };
function setup(t, options) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "data-managed-")),
    root = path.join(parent, "workspace");
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const initialized = initializeManaged(root, options),
    dataset = new Dataset(root);
  return { parent, root, initialized, dataset, file: path.join(root, JOURNAL) };
}
function scoped(e, write = true, target = intent) {
  const registered = e.dataset.registerOperation(
    hash("Exact synthetic repair request"),
    write,
    write ? target : null,
  );
  return {
    ...registered,
    worker: new Dataset(e.root, { credential: registered.credential }),
  };
}
function observe(d) {
  d.get("contact", "C-101");
  d.get("order", "O-501");
}
test("explicit managed initialization is exclusive private and creates fresh instance without model keys", (t) => {
  const e = setup(t),
    another = initializeManaged(path.join(e.parent, "second"));
  assert.notEqual(another.instance_id, e.initialized.instance_id);
  for (const n of ["contacts.csv", "orders.json", JOURNAL])
    assert.equal(fs.statSync(path.join(e.root, n)).mode & 0o777, 0o600);
  assert.equal(fs.statSync(e.root).mode & 0o777, 0o700);
  const before = fs.readFileSync(e.file);
  assert.throws(() => initializeManaged(e.root), /exists/);
  assert.deepEqual(fs.readFileSync(e.file), before);
  assert.equal(
    e.dataset.privateSource().journal.provenance.prior_model_evidence,
    null,
  );
});
test("actual scoped contact repair durably captures original dual evidence reads full before/after and exact caller intent", (t) => {
  const e = setup(t),
    s = scoped(e),
    orders = fs.readFileSync(path.join(e.root, "orders.json"));
  observe(s.worker);
  const result = s.worker.repairContactEmail(input),
    snapshot = e.dataset.privateSource();
  assert.equal(result.contact.revision, "2");
  assert.equal(snapshot.journal.reads.length, 2);
  assert.equal(snapshot.journal.decisions.length, 1);
  const d = snapshot.journal.decisions[0];
  assert.equal(d.status, "applied");
  assert.equal(d.scope.operation_id, s.operation.id);
  assert.equal(d.attempt.newEmail, intent.newEmail);
  assert.equal(d.before.orders_base64, d.after.orders_base64);
  assert.notEqual(d.before.contacts_sha256, d.after.contacts_sha256);
  assert.deepEqual(fs.readFileSync(path.join(e.root, "orders.json")), orders);
  assert.equal(
    new Dataset(e.root).privateSource().journal.decisions[0].status,
    "applied",
  );
});
test("durable reads from another Dataset process instance cannot be borrowed without actual observations", (t) => {
  const e = setup(t),
    s = scoped(e);
  observe(s.worker);
  const fresh = new Dataset(e.root, { credential: s.credential });
  assert.equal(
    fresh.repairContactEmail(input).error,
    "observed_record_required",
  );
  assert.equal(e.dataset.read().contacts[0].revision, "1");
});
test("read-only exact operation rejects repair before a prepared decision", (t) => {
  const e = setup(t),
    s = scoped(e, false);
  observe(s.worker);
  assert.equal(
    s.worker.repairContactEmail(input).error,
    "writes_not_authorized",
  );
  assert.equal(e.dataset.privateSource().journal.decisions.length, 0);
  assert.equal(e.dataset.read().contacts[0].revision, "1");
});
test("caller exact repair value/evidence/identity cannot be expanded by model arguments", (t) => {
  const e = setup(t),
    s = scoped(e);
  observe(s.worker);
  assert.equal(
    s.worker.repairOrderStatus({
      id: "O-503",
      expectedRevision: 1,
      newStatus: "Shipped",
      evidenceEventId: "EV-703",
    }).error,
    "writes_not_authorized",
  );
  assert.equal(
    s.worker.repairContactEmail({
      ...input,
      newEmail: "other@northstar.example",
    }).error,
    "writes_not_authorized",
  );
  assert.equal(
    s.worker.repairContactEmail({ ...input, evidenceOrderId: "O-502" }).error,
    "writes_not_authorized",
  );
  assert.throws(
    () => scoped(e, true, { ...intent, name: "Other Person" }),
    /exact_repair_target/,
  );
  assert.equal(e.dataset.read().contacts[0].revision, "1");
});
test("closed operation fences real worker writes and unknown credentials never fall back to a synthetic human", (t) => {
  const e = setup(t),
    s = scoped(e);
  observe(s.worker);
  e.dataset.closeOperation(s.credential);
  const a = fs.readFileSync(path.join(e.root, "contacts.csv")),
    b = fs.readFileSync(path.join(e.root, "orders.json"));
  assert.throws(() => s.worker.repairContactEmail(input), /operation_closed/);
  assert.throws(
    () =>
      new Dataset(e.root, { credential: "not-valid" }).get("contact", "C-101"),
    /unknown_operation/,
  );
  assert.deepEqual(fs.readFileSync(path.join(e.root, "contacts.csv")), a);
  assert.deepEqual(fs.readFileSync(path.join(e.root, "orders.json")), b);
});
test("same-revision managed source drift rejects the older durable reads and current caller identity", (t) => {
  const e = setup(t),
    s = scoped(e);
  observe(s.worker);
  const file = path.join(e.root, "contacts.csv");
  fs.writeFileSync(
    file,
    fs
      .readFileSync(file, "utf8")
      .replace("Ada Morris,Northstar", "Changed Customer,Other Company"),
  );
  assert.equal(
    s.worker.repairContactEmail(input).error,
    "writes_not_authorized",
  );
  assert.equal(e.dataset.privateSource().journal.decisions.length, 0);
  assert.equal(e.dataset.read().contacts[0].revision, "1");
});
for (const kind of ["read", "attempt", "after-source", "scope", "reuse"])
  test(`tampered managed ${kind} history cannot be accepted or repaired`, (t) => {
    const e = setup(t),
      s = scoped(e);
    observe(s.worker);
    s.worker.repairContactEmail(input);
    const j = JSON.parse(fs.readFileSync(e.file));
    if (kind === "read") j.reads[0].content_sha256 = "0".repeat(64);
    if (kind === "attempt")
      j.decisions[0].attempt.newEmail = "other@northstar.example";
    if (kind === "after-source")
      j.decisions[0].after.contacts_base64 =
        j.decisions[0].before.contacts_base64;
    if (kind === "scope")
      j.decisions[0].scope.operation_id =
        "11111111-1111-4111-8111-111111111111";
    if (kind === "reuse") {
      const d = structuredClone(j.decisions[0]);
      d.id = "11111111-1111-4111-8111-111111111111";
      d.sequence = 2;
      j.decisions.push(d);
    }
    fs.writeFileSync(e.file, JSON.stringify(j));
    const before = fs.readFileSync(e.file),
      csv = fs.readFileSync(path.join(e.root, "contacts.csv"));
    assert.throws(() => e.dataset.read());
    assert.throws(() => e.dataset.repairContactEmail(input));
    assert.deepEqual(fs.readFileSync(e.file), before);
    assert.deepEqual(fs.readFileSync(path.join(e.root, "contacts.csv")), csv);
  });
test("managed no-op consumes fresh durable reads while preserving exact business files and revision", (t) => {
  const e = setup(t),
    s = scoped(e);
  observe(s.worker);
  s.worker.repairContactEmail(input);
  observe(s.worker);
  const csv = fs.readFileSync(path.join(e.root, "contacts.csv")),
    json = fs.readFileSync(path.join(e.root, "orders.json")),
    r = s.worker.repairContactEmail({ ...input, expectedRevision: 2 });
  assert.equal(r.unchanged, true);
  assert.equal(r.contact.revision, "2");
  assert.deepEqual(fs.readFileSync(path.join(e.root, "contacts.csv")), csv);
  assert.deepEqual(fs.readFileSync(path.join(e.root, "orders.json")), json);
  const j = e.dataset.privateSource().journal;
  assert.equal(j.decisions[1].status, "unchanged");
  assert.deepEqual(j.decisions[1].before, j.decisions[1].after);
});
test("post-commit journal failure preserves prepared original evidence and blocks further repair rather than inventing atomicity", (t) => {
  const e = setup(t),
    s = scoped(e);
  observe(s.worker);
  const original = s.worker.saveJournal.bind(s.worker);
  s.worker.saveJournal = (source, journal) => {
    const d = source.journal.decisions.at(-1);
    if (
      d?.status === "prepared" &&
      source.contacts.sha256 === d.after.contacts_sha256
    )
      throw Error("controlled final journal recording failure");
    return original(source, journal);
  };
  assert.throws(
    () => s.worker.repairContactEmail(input),
    (error) => {
      assert.match(error.message, /recording failure/);
      assert.ok(error.partialRepair);
      assert.equal(
        error.partialRepair.actual_source.contacts_sha256,
        error.partialRepair.planned_after.contacts_sha256,
      );
      return true;
    },
  );
  const snapshot = e.dataset.privateSource();
  assert.equal(snapshot.state.contacts[0].revision, "2");
  assert.equal(snapshot.journal.decisions[0].status, "prepared");
  assert.equal(
    s.worker.repairContactEmail({ ...input, expectedRevision: 2 }).error,
    "prepared_repair_outcome_unresolved",
  );
  assert.throws(
    () => e.dataset.registerOperation(hash("next"), false),
    /unresolved/,
  );
  assert.throws(
    () => new Dataset(e.root).get("contact", "C-101"),
    /unresolved/,
  );
  e.dataset.closeOperation(s.credential);
  assert.equal(
    e.dataset.privateSource().journal.operations[0].status,
    "closed",
  );
});
test("missing or replaced managed instance refuses continued authority without reconstructing metadata", (t) => {
  const e = setup(t),
    s = scoped(e);
  observe(s.worker);
  const old = fs.readFileSync(e.file);
  fs.unlinkSync(e.file);
  assert.throws(() => s.worker.repairContactEmail(input), /instance/);
  assert.equal(fs.existsSync(e.file), false);
  fs.writeFileSync(e.file, old);
  const j = JSON.parse(old);
  j.instance_id = "11111111-1111-4111-8111-111111111111";
  fs.writeFileSync(e.file, JSON.stringify(j));
  assert.throws(() => new Dataset(e.root), /instance/);
});
test("malformed or oversized authored input fails before creating any managed destination file", (t) => {
  const parent = fs.mkdtempSync(
    path.join(os.tmpdir(), "data-managed-invalid-"),
  );
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const root = path.join(parent, "bad");
  assert.throws(() => initializeManaged(root, { ordersText: '{"broken":' }));
  assert.equal(fs.existsSync(root), false);
  const valid = fs.readFileSync(
    new URL("../fixtures/orders.json", import.meta.url),
    "utf8",
  );
  assert.throws(
    () =>
      initializeManaged(root, {
        ordersText: " ".repeat(8 * 1024 * 1024) + valid,
      }),
    /byte limit/,
  );
  assert.equal(fs.existsSync(root), false);
});
test("managed order repair uses original full order/events and preserves exact contact file bytes", (t) => {
  const e = setup(t),
    target = {
      kind: "order_status",
      id: "O-503",
      contactId: "C-103",
      email: "luis@acme.example",
      newStatus: "Shipped",
      evidenceEventId: "EV-703",
    },
    s = scoped(e, true, target),
    csv = fs.readFileSync(path.join(e.root, "contacts.csv"));
  s.worker.get("order", "O-503");
  const r = s.worker.repairOrderStatus({
    id: "O-503",
    expectedRevision: 1,
    newStatus: "Shipped",
    evidenceEventId: "EV-703",
  });
  assert.equal(r.order.status, "Shipped");
  assert.equal(r.order.revision, 2);
  assert.deepEqual(fs.readFileSync(path.join(e.root, "contacts.csv")), csv);
  const d = e.dataset.privateSource().journal.decisions[0];
  assert.equal(d.read_ids.length, 1);
  assert.equal(d.status, "applied");
  assert.equal(d.before.contacts_base64, d.after.contacts_base64);
});
test(
  "six actual managed worker processes serialize one scoped file commit with coherent durable reads/decision",
  { timeout: 10000 },
  async (t) => {
    const { spawn } = await import("node:child_process"),
      e = setup(t),
      s = scoped(e),
      module = new URL("../src/dataset.js", import.meta.url).href,
      script = `import{Dataset}from ${JSON.stringify(module)};const d=new Dataset(process.argv[1],{credential:process.argv[2]});d.get('contact','C-101');d.get('order','O-501');process.stdout.write('ready\\n');for await(const b of process.stdin){try{process.stdout.write(JSON.stringify(d.repairContactEmail(JSON.parse(process.argv[3]))));}catch(e){process.stdout.write(JSON.stringify({error:e.message}));}break;}`;
    const children = Array.from({ length: 6 }, () => {
      const child = spawn(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          script,
          e.root,
          s.credential,
          JSON.stringify(input),
        ],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      let out = "",
        err = "",
        ready;
      const prepared = new Promise((r) => (ready = r));
      child.stdout.on("data", (b) => {
        out += b;
        if (out.startsWith("ready\n")) ready();
      });
      child.stderr.on("data", (b) => (err += b));
      const done = new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code) =>
          code === 0
            ? resolve(JSON.parse(out.split("\n").slice(1).join("\n")))
            : reject(Error(err)),
        );
      });
      return { child, prepared, done };
    });
    t.after(() => {
      for (const c of children)
        if (c.child.exitCode === null) c.child.kill("SIGKILL");
    });
    await Promise.all(children.map((c) => c.prepared));
    for (const c of children) c.child.stdin.end("go");
    const results = await Promise.all(children.map((c) => c.done));
    assert.equal(results.filter((r) => r.contact && !r.unchanged).length, 1);
    const snapshot = e.dataset.privateSource();
    assert.equal(snapshot.state.contacts[0].revision, "2");
    assert.equal(snapshot.journal.reads.length, 12);
    assert.equal(snapshot.journal.decisions.length, 1);
    assert.equal(snapshot.journal.decisions[0].status, "applied");
    assert.equal(fs.statSync(e.dataset.lock).mode & 0o777, 0o600);
  },
);
test("corrupt post-commit source remains unknown without masking the original journal error or repairing either file", (t) => {
  const e = setup(t),
    s = scoped(e);
  observe(s.worker);
  const original = s.worker.saveJournal.bind(s.worker);
  s.worker.saveJournal = (source, journal) => {
    const d = source.journal.decisions.at(-1);
    if (
      d?.status === "prepared" &&
      source.contacts.sha256 === d.after.contacts_sha256
    ) {
      fs.writeFileSync(path.join(e.root, "orders.json"), "{broken");
      throw Error("controlled journal failure with corrupt final source");
    }
    return original(source, journal);
  };
  assert.throws(
    () => s.worker.repairContactEmail(input),
    (error) => {
      assert.match(error.message, /journal failure with corrupt final source/);
      assert.equal(error.partialRepair.actual_source, null);
      assert.ok(error.partialRepair.observation_error);
      assert.notEqual(
        error.partialRepair.before.contacts_sha256,
        error.partialRepair.planned_after.contacts_sha256,
      );
      return true;
    },
  );
  assert.equal(
    fs.readFileSync(path.join(e.root, "orders.json"), "utf8"),
    "{broken",
  );
  assert.match(
    fs.readFileSync(path.join(e.root, "contacts.csv"), "utf8"),
    /ada@northstar.example,2/,
  );
  assert.equal(
    JSON.parse(fs.readFileSync(e.file)).decisions[0].status,
    "prepared",
  );
  assert.throws(() => e.dataset.closeOperation(s.credential));
});
