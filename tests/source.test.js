import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { Dataset } from "../src/dataset.js";
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "data-source-"));
  for (const name of ["contacts.csv", "orders.json"])
    fs.copyFileSync(
      new URL("../fixtures/" + name, import.meta.url),
      path.join(dir, name),
    );
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return {
    dir,
    dataset: new Dataset(dir),
    csv: path.join(dir, "contacts.csv"),
    json: path.join(dir, "orders.json"),
  };
}
const input = {
    id: "C-101",
    expectedRevision: 1,
    newEmail: "ada@northstar.example",
    evidenceOrderId: "O-501",
  },
  statusInput = {
    id: "O-503",
    expectedRevision: 1,
    newStatus: "Shipped",
    evidenceEventId: "EV-703",
  };
function observe(d) {
  d.get("contact", "C-101");
  d.get("order", "O-501");
}
function jsonEdit(file, fn) {
  const s = JSON.parse(fs.readFileSync(file));
  fn(s);
  fs.writeFileSync(file, JSON.stringify(s));
}
for (const value of ["", "0", "-1", "true", "1e0", "01", "9007199254740992"])
  test(`noncanonical CSV revision ${JSON.stringify(value)} is rejected before either file changes`, (t) => {
    const e = setup(t);
    fs.writeFileSync(
      e.csv,
      fs
        .readFileSync(e.csv, "utf8")
        .replace("ada@northstar.exmaple,1", "ada@northstar.exmaple," + value),
    );
    const a = fs.readFileSync(e.csv),
      b = fs.readFileSync(e.json);
    assert.throws(() => e.dataset.read());
    assert.throws(() => e.dataset.repairContactEmail(input));
    assert.deepEqual(fs.readFileSync(e.csv), a);
    assert.deepEqual(fs.readFileSync(e.json), b);
  });
for (const kind of [
  "status",
  "contact-reference",
  "event-reference",
  "unknown-field",
  "duplicate-json",
  "bad-utf8",
])
  test(`malformed related ${kind} source blocks a CSV repair without normalization`, (t) => {
    const e = setup(t);
    if (kind === "status")
      jsonEdit(e.json, (s) => (s.orders[1].status = "unknown"));
    if (kind === "contact-reference")
      jsonEdit(e.json, (s) => (s.orders[1].contactId = "missing"));
    if (kind === "event-reference")
      jsonEdit(e.json, (s) => (s.events[0].orderId = "missing"));
    if (kind === "unknown-field")
      jsonEdit(e.json, (s) => (s.orders[1].unverified = "value"));
    if (kind === "duplicate-json")
      fs.writeFileSync(
        e.json,
        fs.readFileSync(e.json, "utf8").replace("{", '{"orders": [],'),
      );
    if (kind === "bad-utf8") fs.appendFileSync(e.json, Buffer.from([255]));
    const a = fs.readFileSync(e.csv),
      b = fs.readFileSync(e.json);
    assert.throws(() => e.dataset.repairContactEmail(input));
    assert.deepEqual(fs.readFileSync(e.csv), a);
    assert.deepEqual(fs.readFileSync(e.json), b);
  });
test("repair needs actual exact record AND evidence reads from this Dataset instance", (t) => {
  const { dataset: d } = setup(t);
  assert.equal(d.repairContactEmail(input).error, "observed_record_required");
  d.get("contact", "C-101");
  assert.equal(d.repairContactEmail(input).error, "observed_record_required");
  d.get("order", "O-501");
  assert.equal(d.repairContactEmail(input).contact.revision, "2");
  assert.equal(
    d.repairContactEmail({ ...input, expectedRevision: 2 }).error,
    "observed_record_required",
  );
});
for (const kind of ["identity", "order-evidence", "unrelated-row"])
  test(`same-revision ${kind} drift cannot reuse original file observations`, (t) => {
    const e = setup(t);
    observe(e.dataset);
    if (kind === "identity")
      fs.writeFileSync(
        e.csv,
        fs
          .readFileSync(e.csv, "utf8")
          .replace(
            "C-101,Ada Morris,Northstar",
            "C-101,Other Customer,Other Company",
          ),
      );
    if (kind === "order-evidence")
      jsonEdit(e.json, (s) => (s.orders[0].status = "Shipped"));
    if (kind === "unrelated-row")
      fs.writeFileSync(
        e.csv,
        fs.readFileSync(e.csv, "utf8").replace("Luis Park", "Luis New"),
      );
    const a = fs.readFileSync(e.csv),
      b = fs.readFileSync(e.json);
    assert.equal(
      e.dataset.repairContactEmail(input).error,
      "dataset_changed_since_read",
    );
    assert.deepEqual(fs.readFileSync(e.csv), a);
    assert.deepEqual(fs.readFileSync(e.json), b);
  });
test("MAX safe revisions reject actual changes while no-ops preserve both exact original files", (t) => {
  const e = setup(t);
  fs.writeFileSync(
    e.csv,
    fs
      .readFileSync(e.csv, "utf8")
      .replace(
        "ada@northstar.exmaple,1",
        "ada@northstar.exmaple,9007199254740991",
      ),
  );
  observe(e.dataset);
  const before = fs.readFileSync(e.csv);
  assert.equal(
    e.dataset.repairContactEmail({
      ...input,
      expectedRevision: Number.MAX_SAFE_INTEGER,
    }).error,
    "revision_exhausted",
  );
  assert.deepEqual(fs.readFileSync(e.csv), before);
  e.dataset.get("order", "O-503");
  assert.equal(e.dataset.repairOrderStatus(statusInput).order.revision, 2);
  const a = fs.readFileSync(e.csv),
    b = fs.readFileSync(e.json);
  e.dataset.get("order", "O-503");
  const noop = e.dataset.repairOrderStatus({
    ...statusInput,
    expectedRevision: 2,
  });
  assert.equal(noop.unchanged, true);
  assert.equal(noop.order.revision, 2);
  assert.deepEqual(fs.readFileSync(e.csv), a);
  assert.deepEqual(fs.readFileSync(e.json), b);
});
test("conflicting order email and shipment evidence cannot select a convenient correction", (t) => {
  const e = setup(t);
  jsonEdit(e.json, (s) =>
    s.orders.push({
      id: "O-504",
      contactId: "C-101",
      email: "different@northstar.example",
      status: "Pending",
      revision: 1,
    }),
  );
  observe(e.dataset);
  assert.equal(
    e.dataset.repairContactEmail(input).error,
    "conflicting_order_email_evidence",
  );
  jsonEdit(e.json, (s) =>
    s.events.push({
      id: "EV-704",
      orderId: "O-503",
      type: "shipment_cancelled",
    }),
  );
  e.dataset.get("order", "O-503");
  assert.equal(
    e.dataset.repairOrderStatus(statusInput).error,
    "conflicting_shipment_evidence",
  );
});
test("strict caller arguments reject unknown fields and coerced/boolean revisions", (t) => {
  const { dataset: d } = setup(t);
  observe(d);
  for (const extra of [
    { ...input, expectedRevision: true },
    { ...input, expectedRevision: "1" },
    { ...input, expectedRevision: 0 },
    { ...input, writeEveryRecord: true },
  ])
    assert.equal(
      d.repairContactEmail(extra).error,
      "invalid_email_repair_arguments",
    );
  assert.equal(d.read().contacts[0].revision, "1");
});
test("actual independent processes serialize one exact CSV commit and keep persistent private lock", async (t) => {
  const e = setup(t),
    module = new URL("../src/dataset.js", import.meta.url).href,
    script = `import{Dataset}from ${JSON.stringify(module)};const d=new Dataset(process.argv[1]);d.get('contact','C-101');d.get('order','O-501');process.stdout.write('ready\\n');for await(const b of process.stdin){try{process.stdout.write(JSON.stringify(d.repairContactEmail(JSON.parse(process.argv[2]))));}catch(e){process.stdout.write(JSON.stringify({error:e.message}));}break;}`;
  const children = Array.from({ length: 6 }, () => {
    const child = spawn(
      process.execPath,
      ["--input-type=module", "-e", script, e.dir, JSON.stringify(input)],
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
  assert.equal(e.dataset.read().contacts[0].revision, "2");
  assert.equal(fs.statSync(e.dataset.lock).mode & 0o777, 0o600);
});
test("source symlinks cannot redirect a repair to another file", (t) => {
  const e = setup(t),
    preserved = fs.readFileSync(e.csv),
    other = e.csv + ".other";
  fs.renameSync(e.csv, other);
  fs.symlinkSync(other, e.csv);
  assert.throws(() => e.dataset.read(), /regular/);
  assert.deepEqual(fs.readFileSync(other), preserved);
});
