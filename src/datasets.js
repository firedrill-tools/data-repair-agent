/** Pinned fictional imports; declared malformed cases stay visibly malformed. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { parseJSON } from "./json.js";
import { readRegular, writeStaged } from "./source.js";
import { hash, canonical, same, identifier } from "./schema.js";
import { parseBusiness } from "./business.js";
import { validateJournal } from "./journal.js";
import { initializeManaged, JOURNAL } from "./managed.js";
import { DATASET_SHA256 } from "./_dataset-manifest.js";
const digest = z.string().regex(/^[a-f0-9]{64}$/),
  sourceSchema = z.strictObject({
    contacts_csv: z
      .string()
      .max(8 * 1024 * 1024)
      .refine((v) => Buffer.byteLength(v) <= 8 * 1024 * 1024),
    orders_json: z
      .string()
      .max(8 * 1024 * 1024)
      .refine((v) => Buffer.byteLength(v) <= 8 * 1024 * 1024),
  }),
  provenanceSchema = z.strictObject({
    kind: z.literal("fictional_imported_data_snapshot"),
    prior_model_evidence: z.null(),
    prior_human_authentication: z.null(),
    prior_external_delivery: z.null(),
  }),
  populationSchema = z.strictObject({
    id: identifier,
    profile: z.enum(["starter", "busy", "ambiguous", "boundary"]),
    task: z.string().min(1).max(8000),
    input_fault: z.enum(["none", "malformed_csv", "malformed_json"]),
    reference_source: sourceSchema,
    source: sourceSchema,
    journal: z.unknown(),
    history: z
      .array(
        z.strictObject({
          sequence: z.number().int().positive(),
          at: z.string().datetime({ offset: false }),
          kind: z.literal("fictional_imported_data_repair"),
          target: identifier,
          decision_sha256: digest,
        }),
      )
      .max(2000),
    provenance: provenanceSchema,
  });
export function faultSource(reference, fault) {
  const source = structuredClone(reference);
  if (fault === "malformed_csv") source.contacts_csv += 'C-999,"unterminated\n';
  else if (fault === "malformed_json") source.orders_json += "\n{";
  return source;
}
const normalized = (source, journal) => {
  const j = structuredClone(journal);
  delete j.instance_id;
  delete j.dataset;
  return { source, journal: j };
};
export const seedHash = (p) => hash(canonical(normalized(p.source, p.journal)));
export function validatePopulation(value) {
  const p = populationSchema.parse(value),
    journal = validateJournal(p.journal),
    reference = parseBusiness(
      p.reference_source.contacts_csv,
      p.reference_source.orders_json,
    );
  if (
    journal.operations.length ||
    journal.dataset ||
    journal.reads.some(
      (r) => r.instance_id !== null || r.scope.kind !== "synthetic_human",
    ) ||
    journal.decisions.some(
      (d) =>
        d.instance_id !== null ||
        d.scope.kind !== "synthetic_human" ||
        d.status === "prepared",
    )
  )
    throw Error("imported seed cannot claim runtime or unresolved authority");
  if (!same(p.source, faultSource(p.reference_source, p.input_fault)))
    throw Error("declared input fault differs from original reference bytes");
  if (p.input_fault === "none")
    parseBusiness(p.source.contacts_csv, p.source.orders_json);
  else {
    let rejected = false;
    try {
      parseBusiness(p.source.contacts_csv, p.source.orders_json);
    } catch {
      rejected = true;
    }
    if (!rejected)
      throw Error("declared malformed population is not malformed");
  }
  const last = journal.decisions.at(-1);
  if (last) {
    if (
      last.after.contacts_sha256 !==
        hash(Buffer.from(p.reference_source.contacts_csv)) ||
      last.after.orders_sha256 !==
        hash(Buffer.from(p.reference_source.orders_json))
    )
      throw Error(
        "last imported decision differs from complete current reference source",
      );
  } else if (
    journal.provenance.seed_contacts_sha256 !==
      hash(Buffer.from(p.reference_source.contacts_csv)) ||
    journal.provenance.seed_orders_sha256 !==
      hash(Buffer.from(p.reference_source.orders_json))
  )
    throw Error("imported seed authorship differs from original source");
  if (p.history.length !== journal.decisions.length)
    throw Error("imported history differs");
  let previous = "";
  for (const [n, item] of p.history.entries()) {
    const d = journal.decisions[n];
    if (
      item.sequence !== n + 1 ||
      item.at < previous ||
      item.target !== d.attempt.id ||
      item.decision_sha256 !== hash(canonical(d))
    )
      throw Error("imported chronology differs from original decision");
    previous = item.at;
  }
  return { ...p, journal };
}
let cached;
function registry() {
  const raw = readRegular(
    fileURLToPath(new URL("../data/index.json", import.meta.url)),
  ).bytes;
  if (hash(raw) !== DATASET_SHA256)
    throw Error("population index differs from pinned original bytes");
  if (!cached) {
    const body = z
        .strictObject({
          id: z.literal("repair-populations"),
          version: z.literal("1.0.0"),
          cases: z.array(z.unknown()).length(12),
        })
        .parse(
          parseJSON(new TextDecoder("utf-8", { fatal: true }).decode(raw)),
        ),
      rows = body.cases.map(validatePopulation);
    if (
      new Set(rows.map((p) => p.id)).size !== 12 ||
      new Set(rows.map((p) => p.profile)).size !== 4
    )
      throw Error("duplicate case or missing profile");
    cached = rows;
  }
  return cached;
}
export const populations = () => structuredClone(registry());
const population = (id) => {
  const p = registry().find((p) => p.id === id);
  if (!p) throw Error("unknown repair case");
  return p;
};
export const listCases = () =>
  registry().map((p) => {
    const r = parseBusiness(
      p.reference_source.contacts_csv,
      p.reference_source.orders_json,
    );
    return {
      id: p.id,
      profile: p.profile,
      task: p.task,
      input_fault: p.input_fault,
      reference_counts: {
        contacts: r.contacts.length,
        orders: r.orders.length,
        events: r.events.length,
      },
      counts_scope:
        "valid reference before any explicitly declared malformed-input image",
      reads: p.journal.reads.length,
      repairs: p.journal.decisions.length,
      pending: p.journal.reads.filter(
        (r) => !p.journal.decisions.some((d) => d.read_ids.includes(r.id)),
      ).length,
    };
  });
const metadataSchema = z.strictObject({
  schema_version: z.literal(1),
  instance_id: z.string().uuid(),
  case_id: identifier,
  dataset_sha256: z.literal(DATASET_SHA256),
  seed_state_sha256: digest,
  created_at: z.string().datetime({ offset: false }),
  scope: z.literal("original_imported_seed_snapshot"),
});
export function authority(root, journal) {
  const file = path.join(root, ".data-repair-source.json");
  if (!journal?.dataset) {
    if (fs.existsSync(file))
      throw Error("managed source is missing its population reference");
    return null;
  }
  const meta = metadataSchema.parse(parseJSON(readRegular(file).text)),
    p = population(journal.dataset.case_id);
  if (
    meta.instance_id !== journal.instance_id ||
    meta.case_id !== journal.dataset.case_id ||
    meta.seed_state_sha256 !== seedHash(p) ||
    journal.dataset.seed_state_sha256 !== meta.seed_state_sha256
  )
    throw Error("private source authority differs from original case/instance");
  return meta;
}
function exclusive(file, value) {
  const fd = fs.openSync(file, "wx", 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(value, null, 2) + "\n");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  const parent = fs.openSync(path.dirname(file), "r");
  try {
    fs.fsyncSync(parent);
  } finally {
    fs.closeSync(parent);
  }
}
export function inspect(root) {
  root = fs.realpathSync(path.resolve(root));
  const csv = readRegular(path.join(root, "contacts.csv")),
    json = readRegular(path.join(root, "orders.json")),
    raw = readRegular(path.join(root, JOURNAL)),
    journal = validateJournal(parseJSON(raw.text)),
    meta = authority(root, journal),
    source = { contacts_csv: csv.text, orders_json: json.text };
  let state = null,
    error = null;
  try {
    state = parseBusiness(csv.text, json.text);
  } catch (e) {
    error = e.message;
  }
  const matched = meta
    ? hash(canonical(normalized(source, journal))) === meta.seed_state_sha256
    : null;
  return {
    ok: true,
    root,
    instance_id: journal.instance_id,
    case_id: journal.dataset?.case_id ?? null,
    dataset_sha256: journal.dataset?.source_sha256 ?? null,
    original_seed_match: matched,
    application_valid: state !== null,
    application_error: error,
    source_hashes: {
      contacts: csv.sha256,
      orders: json.sha256,
      journal: raw.sha256,
    },
    history_scope:
      meta?.scope ?? "explicit_synthetic_source_without_pinned_population",
    provenance: meta
      ? structuredClone(population(meta.case_id).provenance)
      : journal.provenance,
    source,
    journal,
    state,
  };
}
export function initialize(root, caseId = "corrected-contact") {
  root = path.resolve(root);
  const p = population(caseId);
  for (const name of [
    "contacts.csv",
    "orders.json",
    JOURNAL,
    ".data-repair-lock.sqlite",
    ".data-repair-source.json",
  ])
    try {
      fs.lstatSync(path.join(root, name));
      throw Error("private destination already exists; choose a fresh root");
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  const template = {
      ...structuredClone(p.journal),
      dataset: {
        id: "repair-populations",
        version: "1.0.0",
        case_id: p.id,
        source_sha256: DATASET_SHA256,
        seed_state_sha256: seedHash(p),
      },
    },
    created = initializeManaged(root, {
      contactsText: p.reference_source.contacts_csv,
      ordersText: p.reference_source.orders_json,
      journalTemplate: template,
    });
  // Explicitly author the selected malformed image only in this new destination.
  // The normal runtime always performs its original independent source validation.
  if (p.input_fault !== "none") {
    const kind = p.input_fault === "malformed_csv" ? "contacts" : "orders",
      file = path.join(
        root,
        kind === "contacts" ? "contacts.csv" : "orders.json",
      ),
      prior = readRegular(file);
    writeStaged(
      file,
      Buffer.from(
        p.source[kind === "contacts" ? "contacts_csv" : "orders_json"],
      ),
      () => {
        const current = readRegular(file);
        if (
          current.sha256 !== prior.sha256 ||
          current.identity !== prior.identity
        )
          throw Error("private initialization source changed");
      },
    );
  }
  const metadata = {
    schema_version: 1,
    instance_id: created.instance_id,
    case_id: p.id,
    dataset_sha256: DATASET_SHA256,
    seed_state_sha256: seedHash(p),
    created_at: new Date().toISOString(),
    scope: "original_imported_seed_snapshot",
  };
  exclusive(path.join(root, ".data-repair-source.json"), metadata);
  return inspect(root);
}
export function reset(root, destination) {
  if (path.resolve(root) === path.resolve(destination))
    throw Error("reset needs a distinct fresh root");
  const current = inspect(root);
  if (!current.case_id) throw Error("reset requires a pinned original case");
  if (!current.application_valid && !current.original_seed_match)
    throw Error("unrecognized corrupt current source cannot be reset");
  return initialize(destination, current.case_id);
}
