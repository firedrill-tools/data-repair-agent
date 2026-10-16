/** Exclusive explicit model-free synthetic source authorship; no inferred repair. */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { parseBusiness } from "./business.js";
import { validateJournal } from "./journal.js";
import { hash, readRegular } from "./source.js";
export const JOURNAL = ".data-repair-workspace.json";
function exclusive(file, raw) {
  const fd = fs.openSync(file, "wx", 0o600);
  try {
    fs.writeFileSync(fd, raw);
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
export function initializeManaged(root, options = {}) {
  root = path.resolve(root);
  for (const file of [
    "contacts.csv",
    "orders.json",
    JOURNAL,
    ".data-repair-lock.sqlite",
  ]) {
    try {
      fs.lstatSync(path.join(root, file));
      throw Error(
        "managed destination already exists; choose a fresh workspace",
      );
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  if (
    fs.existsSync(root) &&
    (!fs.lstatSync(root).isDirectory() || fs.lstatSync(root).isSymbolicLink())
  )
    throw Error("fresh workspace must be a regular directory");
  const csv =
      options.contactsText ??
      readRegular(new URL("../fixtures/contacts.csv", import.meta.url)).text,
    json =
      options.ordersText ??
      readRegular(new URL("../fixtures/orders.json", import.meta.url)).text;
  parseBusiness(csv, json);
  const journal = validateJournal({
    synthetic: true,
    version: 1,
    instance_id: randomUUID(),
    provenance: {
      kind: "explicit_synthetic_source_author",
      seed_contacts_sha256: hash(Buffer.from(csv)),
      seed_orders_sha256: hash(Buffer.from(json)),
      prior_model_evidence: null,
      prior_human_authentication: null,
      prior_external_delivery: null,
    },
    operations: [],
    reads: [],
    decisions: [],
  });
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  exclusive(path.join(root, "contacts.csv"), Buffer.from(csv));
  exclusive(path.join(root, "orders.json"), Buffer.from(json));
  exclusive(
    path.join(root, JOURNAL),
    Buffer.from(JSON.stringify(journal, null, 2) + "\n"),
  );
  return { root, instance_id: journal.instance_id, journal };
}

export async function main(args = process.argv.slice(2)) {
  const { parseArgs } = await import("node:util");
  try {
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: { help: { type: "boolean" } },
    });
    if (values.help) {
      console.log(
        "data-workspace-init ROOT (exclusive synthetic managed starter; no model key required)",
      );
      return;
    }
    if (positionals.length !== 1) throw Error("provide exactly one fresh ROOT");
    const result = initializeManaged(positionals[0]);
    console.log(
      JSON.stringify(
        {
          ok: true,
          root: result.root,
          instance_id: result.instance_id,
          scope:
            "explicit synthetic starter authorship; rich case provenance/inspect/reset CLI is active development",
        },
        null,
        2,
      ),
    );
  } catch (e) {
    console.log(JSON.stringify({ ok: false, error: e.message }));
    process.exitCode = 1;
  }
}
const { fileURLToPath } = await import("node:url");
if (
  process.argv[1] &&
  fs.existsSync(process.argv[1]) &&
  fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
