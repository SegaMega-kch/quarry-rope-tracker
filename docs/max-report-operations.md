# MAX Report Worker

## Current Status

The user confirmed the single approved connection test in the intended group and approved publishing and production activation on 2026-09-17. No real messages are sent by development tests. Actual deployment, backup and activation results are recorded separately by the operator; the source code alone is not evidence of a running schedule.

The worker is separate from Next.js. It reads the existing inventory database and writes only its own SQLite outbox. There are no inventory-schema migrations for delivery bookkeeping. Do not run a seed, copy a local database to production, or replace the server environment.

## Private Configuration

Keep the JSON configuration, token and outbox outside the checkout, in a private directory (0700 directory, 0600 files on Linux). The JSON contains exactly these string fields:

```json
{
  "sourceDatabase": "/absolute/path/to/existing/inventory.db",
  "outboxDatabase": "/absolute/private/path/max-reports.db",
  "tokenFile": "/absolute/private/path/max-bot.token",
  "botId": "APPROVED_BOT_ID",
  "botUsername": "APPROVED_BOT_USERNAME",
  "chatId": "APPROVED_CHAT_ID",
  "chatTitle": "APPROVED_EXACT_GROUP_TITLE"
}
```

Use the verified identities retained in the local private connection journal, not arbitrary example IDs. The token is read inside the process; never put it in arguments, source control, logs or screenshots. The destination is bound into the outbox on initialization. A different bot/group fails closed. A group rename also stops sending until configuration is deliberately reconciled.

Keep TLS validation enabled. On hosts requiring the Russian Trusted CA, use the reviewed official certificate with NODE_EXTRA_CA_CERTS scoped to this worker. Verify its fingerprint before use; do not install a global trust override. The CLI refuses NODE_TLS_REJECT_UNAUTHORIZED=0. The worker reads only bot identity, group metadata and its own membership; it neither polls group updates nor reads conversations. Group administrator privileges are not required by the successful test.

## Local Commands And Activation

Run the CLI through the repository's installed tsx, using Node 20 or newer:

```text
node node_modules/tsx/dist/cli.mjs scripts/run-max-reports.ts --config /absolute/private/config.json --mode status
```

- `init` creates a NEW outbox exclusively and leaves it disabled. It refuses overwriting a file. It does not read the token or contact MAX. If creation is interrupted, inspect the new file before recovery; never point initialization at inventory.
- `status` shows the persisted schedule flag, UTC epoch-millisecond shift cursor, part counts and attention codes; no credentials or message text.
- `introduction --shift-end <future-morning-ISO> --text-file <absolute-file>` registers approved text before first activation. It is inserted atomically as part 0 before that morning report, with the same delivery safeguards. It is never sent immediately or repeated with later shifts. Different replacement text is refused. If first activation misses the approved time, it fails for operator review rather than silently omitting the introduction.
- `activate` explicitly enables collection/sending eligibility. On first activation the cursor is the NEXT 08:00/20:00 Asia/Yekaterinburg boundary, even if activation occurs exactly at a boundary. It sends nothing itself. Repeated activation/resume retains the existing cursor and pending reports.
- `run --send` starts the worker only if the outbox is already enabled. This is the only mode which reads the token and can call POST /messages. Do not run this against the real recipient during local tests.
- `pause` stops new collection/claims; an already in-flight request may finish. Gracefully stop the PM2 worker as well for maintenance. Resume with `activate`, then start the worker; it catches up from its saved cursor, not all historical app data.
- `inspect --shift-end <ISO-with-zone>` explicitly displays the selected frozen report, warnings and individual part states. It does not send or rebuild it.

After deployment approval: take a fresh consistent on-server inventory backup, retain the previous application version, deploy through GitHub, verify unchanged inventory values with the existing deployment-data guard, and verify the application. Create the private outbox/configuration and validate the identity without sending. Only then explicitly activate and start the worker. Do not send another connection test without approval.

The supplied `scripts/max-reports.pm2.cjs` defines one independent process, `raport-max-reports`. Before starting it, set MAX_REPORT_CONFIG and MAX_REPORT_CA_FILE to the reviewed absolute server paths. It passes only the configuration path and process-scoped CA, not the token. It has bounded crash restart behavior and a graceful shutdown timeout. It is not installed or running as part of the Next.js build. PM2 must retain both the existing web process and this new worker; do not replace the whole process list.

## Delivery And Failure Rules

- A due snapshot, all parts and the next cursor commit together in one SQLite transaction. Frozen text is never regenerated for retry. Multiple workers compete for a SQLite writer lock and a persisted claim; only one part is in flight. Parts and shifts are processed in order.
- SQLite commits use FULL synchronization. Persist the outbox on local durable storage, not a network share. Back it up consistently alongside the inventory: losing or restoring an older outbox can lose delivery confirmations and cause duplicates. Never reset it simply to fix an error.
- A server clock synchronized with real time is required. The schedule uses explicit UTC+5 boundaries, independently of the OS display time zone. The running loop checks each second; delivery is not a hard real-time guarantee.
- Network/identity checks run before the durable POST claim. Failed checks keep the report pending and retry checks in 60 seconds, while collection continues. HTTP 429 is a confirmed rejection and retries with exponential backoff (10 seconds to 15 minutes).
- Confirmed non-429 rejection enters `blocked`. Timeout, network error during POST, HTTP 5xx, unrecognized result or missing message ID enters `review`. These states stop ALL later sending to preserve order, while future reports are still captured. Operator attention is required; the worker emits a fixed `needs-review` log state, not a group message.
- A crash before recording confirmation leaves `sending`; after a two-minute lease it becomes `review`, never an automatic resend. A successful late confirmation can settle only its own attempt. Confirmed earlier parts are never repeated when later parts recover.
- No exactly-once guarantee is claimed: MAX's current send API does not provide an idempotency key in this implementation. The conservative response to uncertainty is to check the actual group before authorizing another send.
- Collection/storage exceptions stop the worker without advancing the cursor; PM2 can restart it. Persistent failures exhaust bounded restarts and need operator attention. Monitor PM2 status/logs and outbox attention counts; this implementation does not yet provide a separate external alert channel.
- If the whole server was down at the boundary, historical PP unloading markers cannot be recovered. The catch-up report retains its shift's available events and explicitly labels the later current PP capture time. Already saved PP state never changes on retry.

## Manual Reconciliation

Stop the worker and use `pause` before resolving a part. For an interrupted send allow the two-minute lease to expire, then inspect the report and check that exact text in the group. Do not infer non-delivery just from a missing local response.

- Already delivered: `resolve-sent --shift-end <ISO-with-zone> --part <number> --message-id <verified-id>` records the verified MAX message ID without resending.
- Definitely absent (or confirmed rejected, after fixing the cause): `resolve-retry --shift-end <ISO-with-zone> --part <number> --confirm-not-delivered` allows a later retry of only that part.
- Both commands leave delivery paused and refuse editing confirmed parts. Resume explicitly after review. Do not delete journals, edit SQLite states manually, or replay a whole shift to solve one uncertain part.
- An optional introduction uses part number 0; the report itself starts at part 1. An uncertain introduction blocks the following report until it is reconciled in the same way.

## Verification

Local tests use isolated disposable databases and mocked MAX calls. They cover disabled startup, activation boundaries, catch-up, frozen text, identity binding, refusal to touch inventory, duplicate captures, rollback, concurrent claims, pacing, partial completion, missing network, rejection, ambiguous delivery, crash recovery, pause and explicit reconciliation. CLI tests require no real credential. Production scheduling and Linux PM2 behavior still need verification during the approved deployment.
