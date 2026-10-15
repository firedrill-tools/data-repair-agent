import path from "node:path";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { Dataset } from "./dataset.js";

const option = (name) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const root = option("--workspace");
if (!root) throw new Error("--workspace required");
const dataset = new Dataset(path.resolve(root));
const allowWrites = process.argv.includes("--allow-writes");
const result = (value) => ({ content: [{ type: "text", text: JSON.stringify(value) }], isError: Boolean(value?.error) });
const safe = (handler) => async (args) => {
  try { return result(await handler(args)); }
  catch (error) { return result({ error: error instanceof Error ? error.message : String(error) }); }
};
const server = new McpServer({ name: "synthetic-data-repair", version: "0.1.0" });
server.registerTool("inspect_datasets", { description: "Inspect dataset names and record counts; validates both files before returning.", inputSchema: z.object({}) }, safe(() => {
  const data = dataset.read(); return { contacts: data.contacts.length, orders: data.orders.length, events: data.events.length };
}));
server.registerTool("find_records", { description: "Search contacts and orders by exact ID, name, company, email or status; names may be ambiguous.", inputSchema: z.object({ query: z.string().min(1) }) }, safe(({ query }) => dataset.find(query)));
server.registerTool("get_record", { description: "Read one exact contact or order ID, including related order events.", inputSchema: z.object({ kind: z.enum(["contact", "order"]), id: z.string().min(1) }) }, safe(({ kind, id }) => dataset.get(kind, id)));
server.registerTool("repair_contact_email", { description: "Update an exact contact's email after matching a related order's confirmed email and the current CSV revision. Requires write authorization.", inputSchema: z.object({ id: z.string(), expectedRevision: z.number().int(), newEmail: z.string(), evidenceOrderId: z.string() }) }, safe((args) => allowWrites ? dataset.repairContactEmail(args) : { error: "writes_not_authorized" }));
server.registerTool("repair_order_status", { description: "Set an exact order to Shipped only with a matching shipment event and current JSON revision. Requires write authorization.", inputSchema: z.object({ id: z.string(), expectedRevision: z.number().int(), newStatus: z.string(), evidenceEventId: z.string() }) }, safe((args) => allowWrites ? dataset.repairOrderStatus(args) : { error: "writes_not_authorized" }));
void serveStdio(() => server, { onerror: (error) => console.error(error.message) });
