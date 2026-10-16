import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { parseJSON } from "./json.js";
import { validateRecords } from "./schema.js";
export const columns = ["id", "name", "company", "email", "revision"];
export function parseBusiness(csv, json) {
  if (csv.split(/\r?\n/, 1)[0] !== columns.join(","))
    throw Error("contacts CSV header malformed");
  const cells = parse(csv, {
    columns: false,
    skip_empty_lines: false,
    relax_quotes: false,
    skip_records_with_error: false,
    max_record_size: 65536,
  });
  if (
    !cells.length ||
    cells[0].join(",") !== columns.join(",") ||
    cells.some((row) => row.length !== columns.length)
  )
    throw Error("contacts CSV records malformed");
  return validateRecords(
    cells
      .slice(1)
      .map((row) => Object.fromEntries(columns.map((key, n) => [key, row[n]]))),
    parseJSON(json),
  );
}
export function repairPlan(original, kind, args) {
  const data = structuredClone(original);
  if (kind === "contact_email") {
    const contact = data.contacts.find((c) => c.id === args.id);
    if (!contact) return { error: "contact_not_found" };
    if (Number(contact.revision) !== args.expectedRevision)
      return { error: "stale_revision" };
    const order = data.orders.find((o) => o.id === args.evidenceOrderId);
    if (!order || order.contactId !== args.id || order.email !== args.newEmail)
      return { error: "evidence_mismatch" };
    if (
      data.orders.some(
        (o) => o.contactId === args.id && o.email !== args.newEmail,
      )
    )
      return { error: "conflicting_order_email_evidence" };
    if (
      data.contacts.some((c) => c.id !== args.id && c.email === args.newEmail)
    )
      return { error: "duplicate_email" };
    if (contact.email === args.newEmail)
      return { record: contact, data, unchanged: true };
    if (args.expectedRevision === Number.MAX_SAFE_INTEGER)
      return { error: "revision_exhausted" };
    contact.email = args.newEmail;
    contact.revision = String(args.expectedRevision + 1);
    return {
      record: contact,
      data,
      unchanged: false,
      file: "contacts",
      content: stringify(data.contacts, { header: true, columns }),
    };
  }
  if (kind !== "order_status") throw Error("unknown repair kind");
  const order = data.orders.find((o) => o.id === args.id);
  if (!order) return { error: "order_not_found" };
  if (order.revision !== args.expectedRevision)
    return { error: "stale_revision" };
  const events = data.events.filter((e) => e.orderId === args.id),
    event = events.find(
      (e) => e.id === args.evidenceEventId && e.type === "shipment_confirmed",
    );
  if (!event) return { error: "evidence_mismatch" };
  if (
    order.status === "Cancelled" ||
    events.some((e) => e.type === "shipment_cancelled") ||
    new Set(
      events
        .filter((e) => e.type === "shipment_confirmed")
        .map((e) => e.tracking),
    ).size > 1
  )
    return { error: "conflicting_shipment_evidence" };
  if (order.status === args.newStatus)
    return { record: order, data, unchanged: true };
  if (order.revision === Number.MAX_SAFE_INTEGER)
    return { error: "revision_exhausted" };
  order.status = args.newStatus;
  order.revision++;
  return {
    record: order,
    data,
    unchanged: false,
    file: "orders",
    content:
      JSON.stringify({ orders: data.orders, events: data.events }, null, 2) +
      "\n",
  };
}
