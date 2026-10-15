import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";

const columns = ["id", "name", "company", "email", "revision"];
const validEmail = (email) => /^[^@\s]+@[^@\s]+\.example$/.test(email);
function atomic(file, text) {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, text);
  fs.renameSync(temp, file);
}
function unique(items, label) {
  const ids = items.map((item) => item.id);
  if (new Set(ids).size !== ids.length) throw new Error(`duplicate ${label} id`);
}
export class Dataset {
  constructor(root) {
    this.root = path.resolve(root);
    this.contactsFile = path.join(this.root, "contacts.csv");
    this.ordersFile = path.join(this.root, "orders.json");
    this.read();
  }
  read() {
    const csv = fs.readFileSync(this.contactsFile, "utf8");
    const header = csv.split(/\r?\n/, 1)[0];
    if (header !== columns.join(",")) throw new Error("contacts CSV header malformed");
    const contacts = parse(csv, { columns: true, skip_empty_lines: true, relax_quotes: false, skip_records_with_error: false });
    if (!contacts.length || contacts.some((item) => Object.keys(item).length !== columns.length || !item.id || !item.name || !item.company || !item.email || !Number.isSafeInteger(Number(item.revision)))) throw new Error("contacts CSV records malformed");
    unique(contacts, "contact");
    const ordersData = JSON.parse(fs.readFileSync(this.ordersFile, "utf8"));
    if (!Array.isArray(ordersData.orders) || !Array.isArray(ordersData.events)) throw new Error("orders JSON malformed");
    if (ordersData.orders.some((item) => !item.id || !item.contactId || !item.email || !Number.isSafeInteger(item.revision))) throw new Error("order record malformed");
    unique(ordersData.orders, "order"); unique(ordersData.events, "event");
    return { contacts, ...ordersData };
  }
  find(query) {
    const q = String(query).trim().toLowerCase();
    if (!q) throw new Error("search query required");
    const data = this.read();
    return { contacts: data.contacts.filter((row) => `${row.id} ${row.name} ${row.company} ${row.email}`.toLowerCase().includes(q)),
      orders: data.orders.filter((row) => `${row.id} ${row.contactId} ${row.email} ${row.status}`.toLowerCase().includes(q)) };
  }
  get(kind, id) {
    const data = this.read();
    if (kind === "contact") return data.contacts.find((row) => row.id === id) || null;
    if (kind === "order") {
      const order = data.orders.find((row) => row.id === id);
      return order ? { ...order, events: data.events.filter((item) => item.orderId === id) } : null;
    }
    throw new Error("unknown record kind");
  }
  repairContactEmail({ id, expectedRevision, newEmail, evidenceOrderId }) {
    const data = this.read();
    const contact = data.contacts.find((item) => item.id === id);
    if (!contact) return { error: "contact_not_found" };
    if (Number(contact.revision) !== expectedRevision) return { error: "stale_revision" };
    if (!validEmail(newEmail)) return { error: "synthetic_email_required" };
    const order = data.orders.find((item) => item.id === evidenceOrderId);
    if (!order || order.contactId !== id || order.email !== newEmail) return { error: "evidence_mismatch" };
    if (data.contacts.some((item) => item.id !== id && item.email === newEmail)) return { error: "duplicate_email" };
    contact.email = newEmail; contact.revision = String(expectedRevision + 1);
    atomic(this.contactsFile, stringify(data.contacts, { header: true, columns }));
    return { contact, evidenceOrderId };
  }
  repairOrderStatus({ id, expectedRevision, newStatus, evidenceEventId }) {
    const data = this.read();
    const order = data.orders.find((item) => item.id === id);
    if (!order) return { error: "order_not_found" };
    if (order.revision !== expectedRevision) return { error: "stale_revision" };
    if (newStatus !== "Shipped") return { error: "unsupported_status_repair" };
    const event = data.events.find((item) => item.id === evidenceEventId && item.orderId === id && item.type === "shipment_confirmed" && item.tracking);
    if (!event) return { error: "evidence_mismatch" };
    order.status = "Shipped"; order.revision += 1;
    atomic(this.ordersFile, `${JSON.stringify({ orders: data.orders, events: data.events }, null, 2)}\n`);
    return { order, evidenceEventId };
  }
}
