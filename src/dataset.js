import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { parseJSON } from "./json.js";
import { validateRecords, emailRepair, statusRepair } from "./schema.js";
import { readRegular, writeStaged } from "./source.js";
export const columns = ["id", "name", "company", "email", "revision"];
const sameFiles = (a, b) =>
  ["contacts", "orders"].every(
    (k) => a[k].sha256 === b[k].sha256 && a[k].identity === b[k].identity,
  );
export class Dataset {
  constructor(root) {
    this.root = fs.realpathSync(path.resolve(root));
    if (!fs.statSync(this.root).isDirectory())
      throw Error("dataset root must be a directory");
    this.contactsFile = path.join(this.root, "contacts.csv");
    this.ordersFile = path.join(this.root, "orders.json");
    this.lock = path.join(this.root, ".data-repair-lock.sqlite");
    this.observed = new Map();
    this.snapshot();
  }
  snapshot() {
    const contacts = readRegular(this.contactsFile),
      orders = readRegular(this.ordersFile);
    if (contacts.text.split(/\r?\n/, 1)[0] !== columns.join(","))
      throw Error("contacts CSV header malformed");
    const cells = parse(contacts.text, {
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
    const records = cells
        .slice(1)
        .map((row) =>
          Object.fromEntries(columns.map((key, n) => [key, row[n]])),
        ),
      state = validateRecords(records, parseJSON(orders.text));
    return { contacts, orders, state };
  }
  read() {
    return this.snapshot().state;
  }
  find(query) {
    if (typeof query !== "string" || !query.trim() || query.length > 240)
      throw Error("bounded search query required");
    const q = query.trim().toLowerCase(),
      data = this.read();
    return {
      contacts: data.contacts.filter((r) =>
        `${r.id} ${r.name} ${r.company} ${r.email}`.toLowerCase().includes(q),
      ),
      orders: data.orders.filter((r) =>
        `${r.id} ${r.contactId} ${r.email} ${r.status}`
          .toLowerCase()
          .includes(q),
      ),
    };
  }
  get(kind, id) {
    if (!["contact", "order"].includes(kind) || typeof id !== "string")
      throw Error("unknown record kind or ID");
    const source = this.snapshot(),
      record = source.state[kind === "contact" ? "contacts" : "orders"].find(
        (r) => r.id === id,
      );
    if (!record) return null;
    this.observed.set(`${kind}:${id}`, source);
    return kind === "contact"
      ? record
      : {
          ...record,
          events: source.state.events.filter((e) => e.orderId === id),
        };
  }
  transaction(handler) {
    if (
      fs.existsSync(this.lock) &&
      (!fs.lstatSync(this.lock).isFile() ||
        fs.lstatSync(this.lock).isSymbolicLink())
    )
      throw Error("invalid dataset mutex");
    try {
      fs.closeSync(fs.openSync(this.lock, "wx", 0o600));
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
    const db = new DatabaseSync(this.lock);
    try {
      db.exec("PRAGMA busy_timeout=5000; BEGIN IMMEDIATE");
      const source = this.snapshot(),
        result = handler(source);
      db.exec("COMMIT");
      return result;
    } catch (e) {
      try {
        db.exec("ROLLBACK");
      } catch {}
      throw e;
    } finally {
      db.close();
    }
  }
  requireRead(source, kind, id) {
    const read = this.observed.get(`${kind}:${id}`);
    if (!read) return "observed_record_required";
    if (!sameFiles(read, source)) return "dataset_changed_since_read";
    return null;
  }
  commit(source, kind, content) {
    const destination =
        kind === "contacts" ? this.contactsFile : this.ordersFile,
      other = kind === "contacts" ? "orders" : "contacts";
    writeStaged(destination, Buffer.from(content), () => {
      if (!sameFiles(source, this.snapshot()))
        throw Error("dataset changed before commit");
    });
    this.observed.clear();
    const after = this.snapshot();
    if (after[other].sha256 !== source[other].sha256)
      throw Error("other dataset changed after one-file commit");
    return {
      before: {
        contacts_sha256: source.contacts.sha256,
        orders_sha256: source.orders.sha256,
      },
      after: {
        contacts_sha256: after.contacts.sha256,
        orders_sha256: after.orders.sha256,
      },
      scope:
        "one flushed dataset file only; no multi-file or ledger atomicity claim",
    };
  }
  repairContactEmail(input) {
    const parsed = emailRepair.safeParse(input);
    if (!parsed.success) return { error: "invalid_email_repair_arguments" };
    const { id, expectedRevision, newEmail, evidenceOrderId } = parsed.data;
    return this.transaction((source) => {
      const data = source.state,
        contact = data.contacts.find((c) => c.id === id);
      if (!contact) return { error: "contact_not_found" };
      if (Number(contact.revision) !== expectedRevision)
        return { error: "stale_revision" };
      const order = data.orders.find((o) => o.id === evidenceOrderId);
      if (!order || order.contactId !== id || order.email !== newEmail)
        return { error: "evidence_mismatch" };
      if (data.orders.some((o) => o.contactId === id && o.email !== newEmail))
        return { error: "conflicting_order_email_evidence" };
      if (data.contacts.some((c) => c.id !== id && c.email === newEmail))
        return { error: "duplicate_email" };
      const reason =
        this.requireRead(source, "contact", id) ??
        this.requireRead(source, "order", evidenceOrderId);
      if (reason) return { error: reason };
      if (contact.email === newEmail) {
        this.observed.clear();
        return { contact, evidenceOrderId, unchanged: true };
      }
      if (expectedRevision === Number.MAX_SAFE_INTEGER)
        return { error: "revision_exhausted" };
      contact.email = newEmail;
      contact.revision = String(expectedRevision + 1);
      const effect = this.commit(
        source,
        "contacts",
        stringify(data.contacts, { header: true, columns }),
      );
      return { contact, evidenceOrderId, unchanged: false, effect };
    });
  }
  repairOrderStatus(input) {
    const parsed = statusRepair.safeParse(input);
    if (!parsed.success) return { error: "invalid_status_repair_arguments" };
    const { id, expectedRevision, newStatus, evidenceEventId } = parsed.data;
    return this.transaction((source) => {
      const data = source.state,
        order = data.orders.find((o) => o.id === id);
      if (!order) return { error: "order_not_found" };
      if (order.revision !== expectedRevision)
        return { error: "stale_revision" };
      const events = data.events.filter((e) => e.orderId === id),
        event = events.find(
          (e) => e.id === evidenceEventId && e.type === "shipment_confirmed",
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
      const reason = this.requireRead(source, "order", id);
      if (reason) return { error: reason };
      if (order.status === newStatus) {
        this.observed.clear();
        return { order, evidenceEventId, unchanged: true };
      }
      if (order.revision === Number.MAX_SAFE_INTEGER)
        return { error: "revision_exhausted" };
      order.status = newStatus;
      order.revision++;
      const effect = this.commit(
        source,
        "orders",
        JSON.stringify({ orders: data.orders, events: data.events }, null, 2) +
          "\n",
      );
      return { order, evidenceEventId, unchanged: false, effect };
    });
  }
}
