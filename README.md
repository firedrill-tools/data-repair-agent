# Data repair agent

A Claude Agent SDK application inspects and repairs synthetic CSV contacts and JSON orders through a narrow local MCP server. Duplicate contact names require exact IDs, email changes require matching order evidence, and shipment status changes require a matching event. The agent has no shell tools and writes are disabled by default.

## Run locally

Requires Node 22+ and npm.

```sh
npm ci
mkdir workspace
cp fixtures/contacts.csv fixtures/orders.json workspace/
```

Set `ANTHROPIC_API_KEY`, then inspect without allowing edits:

```sh
npm run repair -- --workspace workspace --task "Find both Ada Morris contacts and explain which order supports a correction to ada@northstar.example"
```

To allow an exact requested repair:

```sh
npm run repair -- --workspace workspace --task "For contact C-101, use related order O-501 to correct the email to ada@northstar.example. Verify C-102 and the orders are unchanged." --allow-writes
```

`CLAUDE_MODEL` selects an enabled Claude model; the default is `claude-sonnet-4-6`. The agent launches the stdio MCP server itself and allows only `inspect_datasets`, `find_records`, `get_record`, `repair_contact_email` and `repair_order_status`. Each write requires the exact ID, current revision, matching evidence and `--allow-writes`. The final `artifacts/<run-id>/result.json` records the agent answer, SDK cost when available, record counts and changed IDs.

The data tools validate both input files before a write. A malformed CSV or JSON file fails explicitly and remains untouched. Updates replace only one dataset file with an atomic rename. Unrelated rows and orders are preserved semantically, while the other file is byte-for-byte unchanged. The fixture and tool rules are intentionally narrow; this is not a general-purpose database repair engine or a sandbox for arbitrary code.

Reset by copying the fixtures into a fresh workspace. `npm test` covers ambiguity, malformed files, stale revisions, wrong evidence, read-only MCP rejection, and preserving unrelated records. These are offline tool and state checks, not a live Claude run. Live provider and new Firedrill integration proofs remain pending. This private repository has no license pending portfolio publication decisions.

Explore related applications in the [Firedrill example catalog](https://github.com/firedrill-tools/firedrill-example-catalog). Product and setup references: [Firedrill](https://firedrill.run/) and the [official developer documentation](https://docs.firedrill.run/). Use documentation matching the qualified release; this repository records its current integration limits above.

## Development audit active

All4 original checks pass, but actual source probes reproduce same-revision identity drift, empty CSV revision coercion, MAX revision overflow, malformed unrelated order/event acceptance, duplicate JSON normalization and repeated no-op revision increments. [PLAN.md](PLAN.md) tracks complete original CSV/JSON/evidence/read/intent authority, native Claude completion before actual MCP repairs, owned lifecycle/private evidence, rich12case imports/private CLI and fresh locked distributions. The baseline native path is not yet qualified by the offline MCP tests. No paid model or real data action was used; live provider/new Firedrill/real services/publication gates stay parked.

### First source checkpoint

The26 source/real stdio/process checks now reject duplicate JSON, malformed related data, noncanonical revisions and overflow. Both original file hashes/inodes must still match genuine prior record/evidence reads; same-revision drift rejects. Already-correct shipment status preserves exact files/revision. Persistent SQLite serialization and flushed exclusive staging qualify one changed file while preserving the other. Read both the exact contact and evidence order before an email repair, or the full order/events before status repair. See PLAN.md for evidence and precise limits.

Managed durable read/instance/decision history, exact caller repair intent, actual native Claude completion before MCP dispatch and lifecycle/evidence ownership remain active development. Current reads are in-memory, generic MCP write permission is still broader than the intended exact repair scope, and the old runtime has not been qualified. This checkpoint does not complete the project.

Actual native probes now use the canonical bundled Claude runtime, owned loopback Anthropic SSE and real stdio MCP: the ordinary six-request repair succeeds, but controlled `max_tokens` or a missing native `message_stop` still executes the repair and returns success. These are original native fault demonstrations; the current source checkpoint does not fix them. The SDK's cost from synthetic counters is an estimate, not billing. PLAN.md records the private proofs and the next managed-source/native ownership implementation.

The staged owned native transport now passes five actual bundled-SDK/public-hook/inline-tool-bridge/owned-HTTP checks (31 total source/native checks). It rejects original incomplete `max_tokens` and missing `message_stop` before dispatch. The canonical operator still uses its old path; transport wiring follows durable exact repair intent and managed source journaling. The project remains active.

### Managed source implementation

The model-free `initializeManaged` API and Dataset now support durable private original reads, exact caller repair intent, closed/read-only operation enforcement and original before/after prepared/applied/no-op decisions. A six-process managed race commits exactly one repair. The50 source/native/managed checks include tampering, actual partial file effects on journal failure and unknown corrupt final source. A prepared decision blocks further work; its files/evidence are preserved and recovery uses a fresh explicitly initialized/reset destination. A file change and journal update are separate commits, with no multi-file transaction claim. The canonical operator still needs mandatory managed source/worker/native wiring before this path is its default; rich case CLI and distributions follow.
