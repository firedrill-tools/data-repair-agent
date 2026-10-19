# Data repair agent

A Claude Agent SDK application repairs fictional CSV contact emails and JSON shipment status through five narrow MCP tools. It reads exact records and matching evidence, enforces caller permission and exact repair intent, preserves unrelated rows and the other file's original bytes, and reports actual changed, unchanged or uncertain effects separately from model prose.

## Run locally

Requires Node22.13+ and npm. The actual runtime uses Claude Agent SDK0.3.300, MCP client/server2.3.1 and owned Undici7.30.1 HTTP.

```sh
npm ci
npm run workspace -- list
npm run init -- workspace --case corrected-contact
```

Set `ANTHROPIC_API_KEY` and an explicitly enabled `CLAUDE_MODEL`. No model is selected or upgraded automatically. Inspect without writes:

```sh
npm run repair -- --workspace workspace \
  --task "Find both Ada Morris contacts. Read exact C-101 and related order O-501, then explain the evidence without making a change."
```

A local repair requires both the write flag and caller-owned exact intent:

```sh
npm run repair -- --workspace workspace \
  --task "Read C-101 and O-501. Correct only that contact email to ada@northstar.example, reread it, and verify unrelated records remain unchanged." \
  --allow-writes \
  --intent-json '{"kind":"contact_email","id":"C-101","name":"Ada Morris","company":"Northstar","newEmail":"ada@northstar.example","evidenceOrderId":"O-501"}'
```

For shipment repair, intent has `kind: "order_status"`, `id`, `contactId`, `email`, `newStatus: "Shipped"` and `evidenceEventId`. Tool arguments also require the observed current positive safe numeric revision. No-op is a distinct result and preserves business files/revision.

`--model` overrides `CLAUDE_MODEL`. `--base-url` / `ANTHROPIC_BASE_URL` selects an exact HTTPS provider origin or an owned HTTP loopback origin, with no path or redirect. `--output` defaults to `artifacts`; `--timeout-ms` is10–300000 (default120000). The callable `runAgent(options)` supports those fields, `apiKey` and an `AbortSignal`. Injected SDK clients/subprocess replacements are unsupported.

## Original source and managed repair authority

The unchanged fixtures contain duplicate contact names, an intentionally misspelled synthetic contact email, linked orders and shipment evidence. Source validation permits `.example` emails and a declared `.exmaple` fictional typo namespace; repair destinations must be valid `.example`. No email is delivered. CSV headers/columns/positive canonical revisions and bounded fields, complete JSON/order/status/contact/event references, duplicate JSON keys, UTF-8, size, regular file and symlink rules are checked before either file changes. Malformed data is rejected without normalization or repair on read.

Managed initialization explicitly creates fresh UUID/private CSV/JSON plus `.data-repair-workspace.json` (new directories0700/files0600, exclusive names). It never silently infers managed write authority from copied files. Normal `runAgent` requires this managed source. The journal retains original full CSV/JSON byte envelopes and hashes, exact durable record/evidence reads, caller operation/intent, prepared/applied/unchanged decisions and full before/after. The controller and private journal are outside model business tools. Prior imported model evidence, real human authentication and external delivery are unknown.

Email repair needs genuine reads of both the exact contact and chosen order; status repair needs the full order/events. Current complete file bytes/inodes, identity/evidence, instance, exact caller value/evidence target and separate write permission must still match. Model task/record prose cannot broaden those grants. Wrong/read-only/closed operations, missing/borrowed/consumed reads, changed source/revision, contradictory order emails/shipment evidence, unsafe/coerced arguments and revision exhaustion fail without overwriting business data.

A persistent private SQLite lock serializes cooperating processes. Each changed repair writes a durable prepared decision, replaces one flushed staged business file after original-byte/inode checks, then finalizes the journal. These are separate filesystem commits, not a multi-file/database transaction. Unrelated rows remain semantically unchanged; the other file remains byte-for-byte unchanged. A journal failure after a real file change preserves actual source and prepared evidence, blocks further repair/observation/registration, and does not invent success. Inspect privately and use a fresh explicitly initialized/reset destination; there is no automatic repair in place. Corrupt final source stays corrupt and unknown. Existing files/mutex/evidence are preserved. Pinned-case inspection/reset commands below preserve original source and distinguish an authored malformed image from unrecognized corruption.

Direct unbound Dataset calls and a manually launched tool server are declared synthetic human/source-test seams. The normal model runtime uses a fresh private scoped worker; it cannot switch to that human authority. Files and working directories are not an OS sandbox against uncooperative local writers.

## Owned actual model and MCP execution

The normal path uses the actual bundled Claude CLI, public `query`/`spawnClaudeCodeProcess`/`PreToolUse` and `createSdkMcpServer`, a parent-owned five-tool bridge, and a separately owned real stdio MCP worker. Only `inspect_datasets`, `find_records`, `get_record`, `repair_contact_email` and `repair_order_status` are available. Built-in shell/files/settings/session persistence are disabled. Verbatim prompts prevent `@file` expansion. The SDK can add its own ephemeral scratch-directory metadata; that is not a filesystem sandbox. Upstream credentials stay in the parent transport; the SDK gets an opaque per-run proxy key and the worker a separate operation credential/minimal environment.

The owned HTTP proxy retains the original complete Anthropic SSE before giving any tool output to the real CLI. It validates original framing/message/block/stop/error/refusal/known tool name/ID/strict duplicate-free arguments and admits one completed tool at a time. Original completion, exact public permission hook and application callback must agree. Replay, parallel, incomplete, unknown or refused output cannot reach a repair. Final original completed text must match the actual SDK terminal result after tools have drained.

Limits are16prepared native requests/turns,4096output tokens, no upstream retry,30seconds per native HTTP phase and the shared operation deadline. Requests retain up to2MiB; decoded native responses1MiB, with an explicitly incomplete bounded prefix on overflow. At most256SDK messages are retained. These are cooperative application controls, not OS or remote billing guarantees.

Every run prepares private0700/0600 `trace.json` evidence before key/resource checks. It records original requests/SSE/unknown fields/IDs/reported usage, actual hook/stdio observations, original source/journal before/after, SDK normalization, errors and resource exits. Missing, invalid and genuine zero counters differ. Actual cost stays `null`; `sdkReportedCostUsd` is an SDK estimate, not upstream billing. Source differences can include another synthetic actor; scoped applied decisions identify this operation separately. Model prose is not proof of a repair or customer delivery.

Cancellation/deadline/SIGINT/SIGTERM/SIGHUP closes durable write authority before draining actual SDK calls, queued stdio work, bridge, child processes and owned HTTP. An actual queued repair released after operation closure cannot commit. Partial startup and failed close are owned, with one close attempt and honest flags. Earlier file effects survive later native/source/recording/cleanup failure; unknown final source or evidence durability stays unknown.

## Private cases, inspection and reset

Twelve original hash-bound cases span starter, busy, ambiguous and boundary profiles. The busy book has48contacts/60orders/46shipment events/28reads/12prior repairs/8pending reads and12ordered imported history entries. These are actual Dataset-authored fictional changes with deterministic imported UUIDs; prior model evidence, authentication and external delivery stay unknown.

```sh
npm run workspace -- list
npm run workspace -- init another-workspace --case shipment-status
npm run workspace -- inspect workspace
npm run workspace -- reset workspace fresh-workspace
npm run datasets:check
```

Initialization/reset are exclusive private file operations with a new runtime UUID and pinned original seed authority. They preserve old files/mutex/evidence, refuse existing names or missing/corrupt/foreign/stripped authority, and distinguish valid current edits from the original imported seed. Imported null-instance pending reads require fresh actual worker observations. The files are separate exclusive creations; partial initialization stays visible and needs a fresh destination.

Two cases deliberately append malformed CSV or JSON to an otherwise coherent source reference. Their exact original bytes are pinned. The private CLI reports `application_valid: false` and `state: null`; it can inspect/reset the known original image without pretending the normal application accepted it. Unrecognized corrupt current source refuses reset. Normal validation is unconditional and rejects these inputs before SDK/MCP/native requests. There is no case-name branch in runtime repair logic or normalization of invalid data. Case/reference/seed/controller files stay outside model tools and scratch context.

## Verification

`npm test` qualifies92source/native/actual bundled-SDK/public-hook/real-stdio/process/CLI/dataset checks. Ten population cases exercise actual SDK/MCP paths; two are explicit preflight rejections with zero model requests. These are12distinct situations, not12live model trials or a larger campaign. Provider keys and HTTP are synthetic/owned loopback; no paid model or real customer is used.

`npm run package:check` builds and extracts a complete locked source outside checkout, runs all92checks and deterministic authoring, independently installs production-only dependencies, and runs all12installed private case init/inspect/reset commands. It also verifies normal installed symlink CLI/actual SDK/native SSE/real scoped worker/exact repair, missing-key prepared evidence, all SIGINT/SIGTERM/SIGHUP pending native drains, and an actual saved repair followed by a final native failure. Delivered hashes/sizes/modes must remain unchanged and the portable stored-DEFLATE USTAR/gzip source bytes must repeat after installs/tests.

[PLAN.md](PLAN.md) and [COMPATIBILITY.md](COMPATIBILITY.md) record genuine baseline defects, exact checkpoints and limits. The portfolio catalog/ledger records the immutable green Linux run and downloaded original archive equality before independent completion. Live enabled model/key/budget/semantic+billing review, a qualified new Firedrill interface with persisted scenarios/runs, real data services and publication/license stay parked. No license is assigned for publication.

[Firedrill example catalog](https://github.com/firedrill-tools/firedrill-example-catalog).

## Current Firedrill integration

Released CLI/SDK 2.2.2, current command invocation, remote operator MCP and recovery are documented in [firedrill/README.md](firedrill/README.md). Offline checks preserve actual managed-source/native key behavior and independent caller intent. Authenticated persisted runs and live quality/cost remain separate parked gates.
