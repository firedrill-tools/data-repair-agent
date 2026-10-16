import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID, randomBytes } from "node:crypto";
import { parseJSON } from "./json.js";
import { emailRepair, statusRepair, canonical, same, hash } from "./schema.js";
import { readRegular, writeStaged } from "./source.js";
import { columns, parseBusiness, repairPlan } from "./business.js";
import { JOURNAL } from "./managed.js";
import { authority } from "./datasets.js";
import {
  validateJournal,
  intentSchema,
  intentMatches,
  envelope,
  plannedEnvelope,
  readHash,
} from "./journal.js";
export { columns };
const sameFiles = (a, b) =>
  ["contacts", "orders"].every(
    (k) => a[k].sha256 === b[k].sha256 && a[k].identity === b[k].identity,
  );
const sameJournal = (a, b) =>
  (a.journalSource === null && b.journalSource === null) ||
  (a.journalSource &&
    b.journalSource &&
    a.journalSource.sha256 === b.journalSource.sha256 &&
    a.journalSource.identity === b.journalSource.identity);
export class Dataset {
  constructor(root, { credential = null } = {}) {
    this.root = fs.realpathSync(path.resolve(root));
    if (!fs.statSync(this.root).isDirectory())
      throw Error("dataset root must be a directory");
    this.contactsFile = path.join(this.root, "contacts.csv");
    this.ordersFile = path.join(this.root, "orders.json");
    this.journalFile = path.join(this.root, JOURNAL);
    this.lock = path.join(this.root, ".data-repair-lock.sqlite");
    this.observed = new Map();
    this.credential = credential;
    const first = this.snapshot();
    this.instance = first.journal?.instance_id ?? null;
  }
  snapshot() {
    const contacts = readRegular(this.contactsFile),
      orders = readRegular(this.ordersFile),
      state = parseBusiness(contacts.text, orders.text);
    let journalSource = null,
      journal = null;
    try {
      journalSource = readRegular(this.journalFile);
      journal = validateJournal(parseJSON(journalSource.text));
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    authority(this.root, journal);
    if (
      Object.hasOwn(this, "instance") &&
      this.instance !== (journal?.instance_id ?? null)
    )
      throw Error("managed workspace instance changed");
    return { contacts, orders, state, journal, journalSource };
  }
  read() {
    return this.snapshot().state;
  }
  privateSource() {
    const s = this.snapshot();
    return {
      instance_id: s.journal?.instance_id ?? null,
      source: envelope(s),
      journal: s.journal,
      state: s.state,
    };
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
      return structuredClone(result);
    } catch (e) {
      try {
        db.exec("ROLLBACK");
      } catch {}
      throw e;
    } finally {
      db.close();
    }
  }
  saveJournal(source, journal) {
    validateJournal(journal);
    writeStaged(
      this.journalFile,
      Buffer.from(JSON.stringify(journal, null, 2) + "\n"),
      () => {
        const current = this.snapshot();
        if (!sameFiles(source, current) || !sameJournal(source, current))
          throw Error("source/journal changed before durable record");
      },
    );
    return this.snapshot();
  }
  operation(source, credential = this.credential, allowClosed = false) {
    if (credential === null) return null;
    if (
      typeof credential !== "string" ||
      !/^[a-f0-9]{64}$/.test(credential) ||
      !source.journal
    )
      throw Error("unknown_operation");
    const op = source.journal.operations.find(
      (o) => o.credential_sha256 === hash(credential),
    );
    if (!op) throw Error("unknown_operation");
    if (op.status !== "active" && !allowClosed) throw Error("operation_closed");
    return op;
  }
  scope(op) {
    return {
      kind: op ? "operator" : "synthetic_human",
      operation_id: op?.id ?? null,
    };
  }
  registerOperation(taskSha256, allowWrites, intent = null) {
    if (
      typeof taskSha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(taskSha256) ||
      typeof allowWrites !== "boolean"
    )
      throw Error("strict operation permission/task hash required");
    if (allowWrites) intent = intentSchema.parse(intent);
    else if (intent !== null)
      throw Error("read-only operation cannot claim repair intent");
    return this.transaction((source) => {
      if (!source.journal) throw Error("managed_workspace_required");
      if (source.journal.decisions.some((d) => d.status === "prepared"))
        throw Error("prepared_repair_outcome_unresolved");
      if (intent) {
        const args =
          intent.kind === "contact_email"
            ? {
                id: intent.id,
                newEmail: intent.newEmail,
                evidenceOrderId: intent.evidenceOrderId,
              }
            : {
                id: intent.id,
                newStatus: intent.newStatus,
                evidenceEventId: intent.evidenceEventId,
              };
        if (!intentMatches(intent, intent.kind, args, source.state))
          throw Error("exact_repair_target_not_found");
      }
      const credential = randomBytes(32).toString("hex"),
        operation = {
          id: randomUUID(),
          credential_sha256: hash(credential),
          task_sha256: taskSha256,
          allow_writes: allowWrites,
          intent,
          status: "active",
        },
        journal = structuredClone(source.journal);
      journal.operations.push(operation);
      this.saveJournal(source, journal);
      return { credential, operation };
    });
  }
  closeOperation(credential = this.credential) {
    return this.transaction((source) => {
      const op = this.operation(source, credential);
      if (!op) throw Error("operator credential required");
      const journal = structuredClone(source.journal);
      journal.operations.find((o) => o.id === op.id).status = "closed";
      this.saveJournal(source, journal);
      return { operation: journal.operations.find((o) => o.id === op.id) };
    });
  }
  get(kind, id, credential = this.credential) {
    if (!["contact", "order"].includes(kind) || typeof id !== "string")
      throw Error("unknown record kind or ID");
    const observe = (source) => {
      const op = this.operation(source, credential),
        scope = this.scope(op),
        record = source.state[kind === "contact" ? "contacts" : "orders"].find(
          (r) => r.id === id,
        );
      if (!record) return null;
      let read = null;
      if (source.journal) {
        if (source.journal.decisions.some((d) => d.status === "prepared"))
          throw Error("prepared_repair_outcome_unresolved");
        read = {
          id: randomUUID(),
          instance_id: source.journal.instance_id,
          kind,
          record_id: id,
          scope,
          source: envelope(source),
          content_sha256: "",
        };
        read.content_sha256 = readHash(read);
        const journal = structuredClone(source.journal);
        journal.reads.push(read);
        source = this.saveJournal(source, journal);
      }
      this.observed.set(`${scope.operation_id ?? "human"}:${kind}:${id}`, {
        source,
        read,
      });
      return kind === "contact"
        ? record
        : {
            ...record,
            events: source.state.events.filter((e) => e.orderId === id),
          };
    };
    return this.instance !== null
      ? this.transaction(observe)
      : observe(this.snapshot());
  }
  requireRead(source, kind, id, scope) {
    const observed = this.observed.get(
      `${scope.operation_id ?? "human"}:${kind}:${id}`,
    );
    if (!observed) return { error: "observed_record_required" };
    if (!sameFiles(observed.source, source))
      return { error: "dataset_changed_since_read" };
    if (source.journal) {
      const r = source.journal.reads.find((r) => r.id === observed.read?.id);
      if (
        !r ||
        r.instance_id !== source.journal.instance_id ||
        r.content_sha256 !== observed.read.content_sha256 ||
        !same(r.scope, scope) ||
        !same(r.source, envelope(source))
      )
        return { error: "durable_read_changed" };
      if (source.journal.decisions.some((d) => d.read_ids.includes(r.id)))
        return { error: "observed_read_consumed" };
      return { read: r };
    }
    return { read: null };
  }
  repairContactEmail(input, credential = this.credential) {
    return this.repair("contact_email", input, credential);
  }
  repairOrderStatus(input, credential = this.credential) {
    return this.repair("order_status", input, credential);
  }
  repair(kind, input, credential = this.credential) {
    const parsed = (
      kind === "contact_email" ? emailRepair : statusRepair
    ).safeParse(input);
    if (!parsed.success)
      return {
        error:
          kind === "contact_email"
            ? "invalid_email_repair_arguments"
            : "invalid_status_repair_arguments",
      };
    const args = parsed.data;
    return this.transaction((original) => {
      let source = original;
      const op = this.operation(source, credential),
        scope = this.scope(op);
      if (
        op &&
        (!op.allow_writes ||
          !intentMatches(op.intent, kind, args, source.state))
      )
        return { error: "writes_not_authorized" };
      if (source.journal?.decisions.some((d) => d.status === "prepared"))
        return { error: "prepared_repair_outcome_unresolved" };
      const plan = repairPlan(source.state, kind, args);
      if (plan.error) return { error: plan.error };
      const required =
          kind === "contact_email"
            ? [
                ["contact", args.id],
                ["order", args.evidenceOrderId],
              ]
            : [["order", args.id]],
        proofs = required.map(([k, id]) =>
          this.requireRead(source, k, id, scope),
        );
      if (proofs.some((p) => p.error))
        return { error: proofs.find((p) => p.error).error };
      const before = envelope(source),
        after = plannedEnvelope(before, plan);
      let decision;
      if (source.journal) {
        decision = {
          id: randomUUID(),
          sequence: source.journal.decisions.length + 1,
          instance_id: source.journal.instance_id,
          kind,
          read_ids: proofs.map((p) => p.read.id),
          scope,
          attempt: args,
          before,
          after,
          status: plan.unchanged ? "unchanged" : "prepared",
        };
        const journal = structuredClone(source.journal);
        journal.decisions.push(decision);
        source = this.saveJournal(source, journal);
      }
      if (!plan.unchanged) {
        try {
          writeStaged(
            plan.file === "contacts" ? this.contactsFile : this.ordersFile,
            Buffer.from(plan.content),
            () => {
              const current = this.snapshot();
              if (!sameFiles(source, current) || !sameJournal(source, current))
                throw Error("dataset/repair authority changed before commit");
              if (op && this.operation(current, credential).status !== "active")
                throw Error("operation_closed");
            },
          );
          const current = this.snapshot();
          if (!same(envelope(current), after))
            throw Error("actual source differs after one-file commit");
          if (decision) {
            const journal = structuredClone(current.journal);
            journal.decisions.find((d) => d.id === decision.id).status =
              "applied";
            source = this.saveJournal(current, journal);
          }
        } catch (e) {
          let actual = null,
            observationError = null;
          try {
            actual = envelope(this.snapshot());
          } catch (observation) {
            observationError = { message: observation.message };
          }
          e.partialRepair = {
            decision_id: decision?.id ?? null,
            before,
            planned_after: after,
            actual_source: actual,
            observation_error: observationError,
            journal_status:
              "prepared or unknown; inspect original source; no automatic repair",
          };
          throw e;
        }
      }
      this.observed.clear();
      return {
        [kind === "contact_email" ? "contact" : "order"]: plan.record,
        [kind === "contact_email" ? "evidenceOrderId" : "evidenceEventId"]:
          args[
            kind === "contact_email" ? "evidenceOrderId" : "evidenceEventId"
          ],
        unchanged: plan.unchanged,
        ...(decision ? { decision_id: decision.id } : {}),
        ...(!plan.unchanged
          ? {
              effect: {
                before: {
                  contacts_sha256: before.contacts_sha256,
                  orders_sha256: before.orders_sha256,
                },
                after: {
                  contacts_sha256: after.contacts_sha256,
                  orders_sha256: after.orders_sha256,
                },
                scope:
                  "one flushed business file plus distinct prepared/final journal writes; not a multi-file transaction",
              },
            }
          : {}),
      };
    });
  }
}
