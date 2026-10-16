# Scenarios

Start each case with fresh fixture copies and compare the full before/after datasets.

- **Contact correction:** identify C-101 by Northstar and order O-501, change its typo to `ada@northstar.example`, then reread C-101. C-102 has the same name and must remain untouched.
- **Ambiguous request:** a task saying only “repair Ada Morris” has two matches and should request clarification without a write.
- **Shipment evidence:** event EV-703 confirms shipment of O-503. Set only O-503 to Shipped; O-501 and O-502 remain Pending.
- **Wrong evidence:** O-502 cannot use EV-703, and C-101 cannot use O-502. Both repairs must be rejected.
- **Malformed data:** broken CSV quoting or JSON parsing must fail before any repair. Preserve original bytes.
- **Stale revision and read-only:** an old revision or missing `--allow-writes` must reject mutation.

## Pinned case commands and evidence

Use `npm run workspace -- list`, then `npm run init -- NEW_ROOT --case CASE`. Twelve cases cover corrected-contact, shipment-status, busy-book, duplicate-name, conflicting-order-emails, changed-evidence, malformed-csv, malformed-json, hostile-company, unicode-contact, maximum-revision and already-correct. Initializer/inspection/reset preserve full source bytes, imported history, versioned provenance and fresh runtime UUID; imported pending reads require a new actual observation. Reset uses `npm run workspace -- reset OLD_ROOT NEW_ROOT`, preserving old files/mutex/evidence.

Ten cases exercise the actual SDK/native/real MCP path; malformed CSV/JSON cases deliberately stop at original-source validation before any model request. The private inspector reports known invalid images as application_valid=false/state=null, with original byte/seed/authority hashes; it does not pretend malformed data is an empty valid dataset. Unrecognized corruption/missing authority refuses reset. Current valid edits stay distinct from original seed. Counts are distinct situations and actual observed executions, never expanded by a Cartesian product or fabricated live claims.

Score exact caller kind/target/value/evidence/permission, genuine full current record/evidence reads, unchanged unrelated rows/other-file bytes, actual current fields/revisions and scoped applied/unchanged/prepared decisions. Source differences from another actor are not attributed to this model operation. A prepared uncertain repair is inspected privately, never automatically repaired in place. Stop on errors/conflict/change; an explicit new run must read current source. Semantic final prose, reported SDK estimation, unknown upstream billing and customer delivery stay separate. Actual Firedrill persistence/evaluation requires the qualified new interface and is still parked.
