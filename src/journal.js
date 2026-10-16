/** Strict durable fictional observations and one-file prepared repair decisions. */
import { z } from "zod";
import {
  identifier,
  line,
  email,
  emailRepair,
  statusRepair,
  canonical,
  same,
  hash,
} from "./schema.js";
import { parseBusiness, repairPlan } from "./business.js";
const digest = z.string().regex(/^[a-f0-9]{64}$/),
  uuid = z.string().uuid();
export const intentSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("contact_email"),
    id: identifier,
    name: line(160),
    company: line(240),
    newEmail: email,
    evidenceOrderId: identifier,
  }),
  z.strictObject({
    kind: z.literal("order_status"),
    id: identifier,
    contactId: identifier,
    email,
    newStatus: z.literal("Shipped"),
    evidenceEventId: identifier,
  }),
]);
const envelopeSchema = z.strictObject({
  contacts_base64: z.string().max(12 * 1024 * 1024),
  orders_base64: z.string().max(12 * 1024 * 1024),
  contacts_sha256: digest,
  orders_sha256: digest,
});
const scopeSchema = z.strictObject({
  kind: z.enum(["operator", "synthetic_human"]),
  operation_id: uuid.nullable(),
});
const operationSchema = z.strictObject({
  id: uuid,
  credential_sha256: digest,
  task_sha256: digest,
  allow_writes: z.boolean(),
  intent: intentSchema.nullable(),
  status: z.enum(["active", "closed"]),
});
const readSchema = z.strictObject({
  id: uuid,
  instance_id: uuid.nullable(),
  kind: z.enum(["contact", "order"]),
  record_id: identifier,
  scope: scopeSchema,
  source: envelopeSchema,
  content_sha256: digest,
});
const decisionSchema = z.strictObject({
  id: uuid,
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  instance_id: uuid.nullable(),
  kind: z.enum(["contact_email", "order_status"]),
  read_ids: z.array(uuid).min(1).max(2),
  scope: scopeSchema,
  attempt: z.union([emailRepair, statusRepair]),
  before: envelopeSchema,
  after: envelopeSchema,
  status: z.enum(["prepared", "applied", "unchanged"]),
});
const journalSchema = z.strictObject({
  synthetic: z.literal(true),
  version: z.literal(1),
  instance_id: uuid,
  provenance: z.strictObject({
    kind: z.literal("explicit_synthetic_source_author"),
    seed_contacts_sha256: digest,
    seed_orders_sha256: digest,
    prior_model_evidence: z.null(),
    prior_human_authentication: z.null(),
    prior_external_delivery: z.null(),
  }),
  operations: z.array(operationSchema).max(512),
  reads: z.array(readSchema).max(4000),
  decisions: z.array(decisionSchema).max(2000),
});
export const readHash = (r) => {
  const value = { ...r };
  delete value.content_sha256;
  return hash(canonical(value));
};
export const envelope = (source) => ({
  contacts_base64: source.contacts.bytes.toString("base64"),
  orders_base64: source.orders.bytes.toString("base64"),
  contacts_sha256: source.contacts.sha256,
  orders_sha256: source.orders.sha256,
});
export function decodeEnvelope(value) {
  const e = envelopeSchema.parse(value),
    text = {};
  for (const kind of ["contacts", "orders"]) {
    const raw = Buffer.from(e[kind + "_base64"], "base64");
    if (
      raw.length > 8 * 1024 * 1024 ||
      raw.toString("base64") !== e[kind + "_base64"] ||
      hash(raw) !== e[kind + "_sha256"]
    )
      throw Error("original journal dataset envelope differs");
    text[kind] = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  }
  return parseBusiness(text.contacts, text.orders);
}
export function plannedEnvelope(before, plan) {
  if (plan.unchanged) return structuredClone(before);
  const result = structuredClone(before),
    raw = Buffer.from(plan.content);
  result[plan.file + "_base64"] = raw.toString("base64");
  result[plan.file + "_sha256"] = hash(raw);
  return result;
}
export function intentMatches(intent, kind, args, state) {
  if (!intent || intent.kind !== kind || intent.id !== args.id) return false;
  if (kind === "contact_email") {
    const c = state.contacts.find((c) => c.id === args.id);
    return (
      !!c &&
      c.name === intent.name &&
      c.company === intent.company &&
      args.newEmail === intent.newEmail &&
      args.evidenceOrderId === intent.evidenceOrderId
    );
  }
  const o = state.orders.find((o) => o.id === args.id);
  return (
    !!o &&
    o.contactId === intent.contactId &&
    o.email === intent.email &&
    args.newStatus === intent.newStatus &&
    args.evidenceEventId === intent.evidenceEventId
  );
}
export function validateJournal(value) {
  const j = journalSchema.parse(value),
    ops = new Map(j.operations.map((o) => [o.id, o])),
    reads = new Map(j.reads.map((r) => [r.id, r]));
  for (const [key, rows] of [
    ["operation", j.operations],
    ["read", j.reads],
    ["decision", j.decisions],
  ])
    if (new Set(rows.map((r) => r.id)).size !== rows.length)
      throw Error("duplicate journal " + key);
  if (
    new Set(j.operations.map((o) => o.credential_sha256)).size !==
    j.operations.length
  )
    throw Error("duplicate operation credential");
  for (const o of j.operations)
    if (o.allow_writes ? !o.intent : o.intent !== null)
      throw Error("operation permission/intent differs");
  const scopeValid = (s) => {
    if (
      s.kind === "synthetic_human"
        ? s.operation_id !== null
        : !ops.has(s.operation_id)
    )
      throw Error("journal scope differs");
  };
  for (const r of j.reads) {
    scopeValid(r.scope);
    if (
      (r.instance_id !== null && r.instance_id !== j.instance_id) ||
      (r.scope.kind === "operator" && r.instance_id !== j.instance_id)
    )
      throw Error("observed workspace instance differs");
    const state = decodeEnvelope(r.source);
    if (
      !state[r.kind === "contact" ? "contacts" : "orders"].some(
        (record) => record.id === r.record_id,
      ) ||
      r.content_sha256 !== readHash(r)
    )
      throw Error("durable read differs from its original source");
  }
  const consumed = new Set();
  for (const [n, d] of j.decisions.entries()) {
    scopeValid(d.scope);
    if (
      d.sequence !== n + 1 ||
      (d.instance_id !== null && d.instance_id !== j.instance_id) ||
      (d.scope.kind === "operator" && d.instance_id !== j.instance_id)
    )
      throw Error("decision sequence/instance differs");
    const state = decodeEnvelope(d.before),
      args = (d.kind === "contact_email" ? emailRepair : statusRepair).parse(
        d.attempt,
      ),
      plan = repairPlan(state, d.kind, args);
    if (
      plan.error ||
      !same(plannedEnvelope(d.before, plan), d.after) ||
      (plan.unchanged
        ? d.status !== "unchanged"
        : !["prepared", "applied"].includes(d.status))
    )
      throw Error(
        "repair decision differs from its original complete source/attempt",
      );
    decodeEnvelope(d.after);
    const required =
      d.kind === "contact_email"
        ? [
            ["contact", args.id],
            ["order", args.evidenceOrderId],
          ]
        : [["order", args.id]];
    if (
      new Set(d.read_ids).size !== d.read_ids.length ||
      d.read_ids.length !== required.length ||
      required.some(
        ([kind, id]) =>
          !d.read_ids.some((rid) => {
            const r = reads.get(rid);
            return (
              r &&
              r.kind === kind &&
              r.record_id === id &&
              r.instance_id === d.instance_id &&
              same(r.scope, d.scope) &&
              same(r.source, d.before)
            );
          }),
      )
    )
      throw Error(
        "decision lacks exact original durable record/evidence reads",
      );
    for (const id of d.read_ids) {
      if (consumed.has(id)) throw Error("durable read was consumed twice");
      consumed.add(id);
    }
    if (d.scope.kind === "operator") {
      const op = ops.get(d.scope.operation_id);
      if (!op.allow_writes || !intentMatches(op.intent, d.kind, args, state))
        throw Error("decision lacked exact caller intent");
    }
  }
  return j;
}
