import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Dataset } from "../src/dataset.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "data-repair-"));
  for (const name of ["contacts.csv", "orders.json"]) fs.copyFileSync(path.join(root, "fixtures", name), path.join(dir, name));
  return { dir, dataset: new Dataset(dir) };
}
async function connect(dir, allowWrites) {
  const client = new Client({ name: "offline-data-repair-test", version: "1.0.0" });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [path.join(root, "src/mcp-server.js"), "--workspace", dir, ...(allowWrites ? ["--allow-writes"] : [])] });
  await client.connect(transport);
  return { client, call: async (name, args = {}) => client.callTool({ name, arguments: args }) };
}
const body = (result) => JSON.parse(result.content[0].text);

test("ambiguous name and malformed files do not cause repairs", () => {
  const { dir, dataset } = setup();
  assert.equal(dataset.find("Ada Morris").contacts.length, 2);
  assert.equal(dataset.repairContactEmail({ id: "C-101", expectedRevision: 1, newEmail: "ada@northstar.example", evidenceOrderId: "O-502" }).error, "evidence_mismatch");
  assert.equal(dataset.repairContactEmail({ id: "C-101", expectedRevision: 0, newEmail: "ada@northstar.example", evidenceOrderId: "O-501" }).error, "stale_revision");
  assert.equal(dataset.repairContactEmail({ id: "C-101", expectedRevision: 1, newEmail: "ada@gmail.com", evidenceOrderId: "O-501" }).error, "synthetic_email_required");
  assert.equal(dataset.get("contact", "C-101").revision, "1");
  const csv = fs.readFileSync(path.join(dir, "contacts.csv"), "utf8");
  fs.writeFileSync(path.join(dir, "contacts.csv"), `${csv}C-999,"unterminated\n`);
  assert.throws(() => dataset.read());
  assert.throws(() => dataset.repairContactEmail({ id: "C-101", expectedRevision: 1, newEmail: "ada@northstar.example", evidenceOrderId: "O-501" }));
  assert.match(fs.readFileSync(path.join(dir, "contacts.csv"), "utf8"), /unterminated/);
  fs.writeFileSync(path.join(dir, "contacts.csv"), csv);
  fs.writeFileSync(path.join(dir, "orders.json"), "{bad json");
  assert.throws(() => dataset.read());
  assert.equal(fs.readFileSync(path.join(dir, "contacts.csv"), "utf8"), csv);
});

test("CSV email repair preserves unrelated rows and JSON bytes", () => {
  const { dir, dataset } = setup();
  const before = dataset.read();
  const ordersBytes = fs.readFileSync(path.join(dir, "orders.json"), "utf8");
  const repaired = dataset.repairContactEmail({ id: "C-101", expectedRevision: 1, newEmail: "ada@northstar.example", evidenceOrderId: "O-501" });
  assert.equal(repaired.contact.revision, "2");
  assert.equal(dataset.get("contact", "C-101").email, "ada@northstar.example");
  assert.deepEqual(dataset.read().contacts.filter((row) => row.id !== "C-101"), before.contacts.filter((row) => row.id !== "C-101"));
  assert.equal(fs.readFileSync(path.join(dir, "orders.json"), "utf8"), ordersBytes);
  assert.equal(dataset.repairContactEmail({ id: "C-101", expectedRevision: 1, newEmail: "ada@northstar.example", evidenceOrderId: "O-501" }).error, "stale_revision");
});

test("JSON status repair needs matching event and preserves other orders and CSV bytes", () => {
  const { dir, dataset } = setup();
  const before = dataset.read(); const csvBytes = fs.readFileSync(path.join(dir, "contacts.csv"), "utf8");
  assert.equal(dataset.repairOrderStatus({ id: "O-502", expectedRevision: 1, newStatus: "Shipped", evidenceEventId: "EV-703" }).error, "evidence_mismatch");
  const repaired = dataset.repairOrderStatus({ id: "O-503", expectedRevision: 1, newStatus: "Shipped", evidenceEventId: "EV-703" });
  assert.equal(repaired.order.revision, 2);
  assert.equal(dataset.get("order", "O-503").status, "Shipped");
  assert.deepEqual(dataset.read().orders.filter((row) => row.id !== "O-503"), before.orders.filter((row) => row.id !== "O-503"));
  assert.equal(fs.readFileSync(path.join(dir, "contacts.csv"), "utf8"), csvBytes);
});

test("real stdio MCP tools enforce read-only and exact evidence-bound repairs", async () => {
  const { dir, dataset } = setup();
  const readonly = await connect(dir, false);
  try {
    assert.deepEqual((await readonly.client.listTools()).tools.map((item) => item.name).sort(),
      ["find_records", "get_record", "inspect_datasets", "repair_contact_email", "repair_order_status"]);
    assert.equal(body(await readonly.call("find_records", { query: "Ada Morris" })).contacts.length, 2);
    const rejected = await readonly.call("repair_contact_email", { id: "C-101", expectedRevision: 1, newEmail: "ada@northstar.example", evidenceOrderId: "O-501" });
    assert.equal(rejected.isError, true); assert.equal(body(rejected).error, "writes_not_authorized");
    assert.equal(dataset.get("contact", "C-101").revision, "1");
  } finally { await readonly.client.close(); }
  const writable = await connect(dir, true);
  try {
    const repaired = await writable.call("repair_contact_email", { id: "C-101", expectedRevision: 1, newEmail: "ada@northstar.example", evidenceOrderId: "O-501" });
    assert.equal(repaired.isError, false);
    assert.equal(body(await writable.call("get_record", { kind: "contact", id: "C-101" })).email, "ada@northstar.example");
    assert.equal(dataset.get("contact", "C-102").email, "ada@harbor.example");
  } finally { await writable.client.close(); }
});
