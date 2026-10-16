# Data repair agent development plan

## Goal

Complete the independent synthetic Claude Agent SDK/data MCP application for exact evidence-bound CSV contact email and JSON order shipment repairs. Preserve unrelated rows, semantic fields and the other file's exact bytes. Keep actual databases/production data/connectors, live enabled Claude credentials/budget/semantic+billing review, a qualified new Firedrill interface/persisted scenarios and publication/license parked. No broad shell/filesystem tools for the model.

## Reproduced baseline

At d4774e481feaafd5d09619d556aaa3ee8fc88a40 all4 original checks pass (/tmp/firedrill-data-repair-baseline-tests.log). Actual private synthetic Dataset probes in /tmp/firedrill-data-repair-source-baseline.{mjs,json,log} reproduce:

- A same-revision changed contact name/company still repairs from the older identity read.
- An empty CSV revision is coerced to zero and repaired to1.
- MAX_SAFE_INTEGER contact revision writes9007199254740992.
- Invalid unrelated order status and a shipment event referencing a missing order pass validation while the contact file is changed.
- Duplicate original JSON orders fields silently normalize before a shipment repair.
- Repeating an already-Shipped repair at its current revision increments revision again.

These are actual local source defects, no real customer or model was used. The normal native SDK path still needs an actual owned HTTP probe; offline stdio tests do not qualify native tool dispatch or resource ownership.

## Tasks and completion gates

1. **Active: complete original source and repair contract.** Strict bounded regular original CSV/JSON with fatal UTF-8 and duplicate-aware JSON; preserve intentional fictional email typo as declared repairable source without treating arbitrary invalid data as safe. Exact noncoerced positive safe revision, statuses/IDs/contact-order-event relationships, valid synthetic delivery facts, no missing/dangling/duplicate references or unknown normalized fields. Do not repair malformed data on read. Preserve original fixture bytes. Observe full current contact/order and relevant source evidence before writes; immutable read IDs/hashes, complete current identity/company/evidence/instance equality and strict arguments. Caller-owned exact structured repair intent plus separate permission, independent of task/data prose; no repair of another record/value/evidence. Wrong/closed scope, stale/changed source, replay, overflow and no-op distinctions. Persistent cooperating-process serialization and flushed staged original-byte/inode recheck before one-file replacement. Other file bytes and unrelated semantic rows stay unchanged. Durable prepared/partial/save observation must describe the actual one-file commit and journal boundary; do not promise multi-file or filesystem/database atomicity.
2. **Pending: actual pinned Claude runtime/native ownership.** Inspect installed0.3.300 query/public spawn/PreToolUse/createSdkMcpServer behavior and actual owned loopback Anthropic HTTP before claiming completion. No injected fake production child/vendor cache/global patch. Original fully completed native messages/errors/refusals/IDs/strict exact known args before eager repair tools; bounded explicit model/key/endpoint, prepared calls/output/retries/deadline/cancel/decoded bytes. Preserve original usage/unknown native fields/IDs separately from SDK normalization, genuine zero versus unknown, cost unknown. Original completed final answer must agree with actual SDK result and drained tools. Prepared/failed receipts before keys/resources, retain earlier CSV/JSON effects on later native/evidence/source/close failure.
3. **Pending: owned narrow actual stdio MCP.** Application owns the real worker/client/transport/process and narrow five-tool bridge; built-in shell/filesystem/settings/session tools disabled. Separate private controller source/permission/journal access from model business views. Read-only/exact intent enforced at worker and commit. No hidden grading answers/fixtures/capture authority in tools. Await active tools and child exits; stop authority before late writes on parent/deadline/CLI cancellation; own partial startup and one-attempt failed close with truthful status. Synthetic data and dependency isolation limits are explicit; working directory alone is not a sandbox.
4. **Pending: rich coherent imports and private CLI.**12hash-bound cases/four profiles with busy linked contacts/orders/shipment events/prior repair history/pending reads and real Store-authored changes. Cover duplicate names/identity/evidence conflict, malformed CSV/JSON, no matching event, changed actor, hostile/Unicode/long fields, MAX and already-correct values. Prior model/authentication/real delivery remains unknown. Exclusive model-free private init/inspect/reset with fresh instance and pinned source/seed metadata, collision/corrupt/missing/foreign authority rejection; reset preserves old files/mutex/evidence. Imported pending reads require fresh observation under new instance.
5. **Pending: fresh complete/production-only distribution.** Locked complete source outside checkout runs meaningful source/native/real MCP/process/CLI/dataset checks, all12 installed private case commands, actual installed normal native CLI, missing keys/all three signals/partial failure, unchanged original delivered manifest and repeated portable archive bytes. Push private repo, require exact-head Linux green and downloaded original source artifact byte/hash equality before independent completion. Then continue #29/#30/#33/#34/#35/#37/#38/#39. Overall portfolio goal remains active.

## Current status

Baseline source analysis and4original checks are complete; task1 implementation is next. Native SDK behavior, complete source authority, data scale and distributions remain unqualified. User-dependent live keys/services/publication/Firedrill integration stay parked while independent development continues.
