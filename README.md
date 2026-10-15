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
