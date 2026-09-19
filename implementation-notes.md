# Implementation Notes

## Scope

- Harden server-side validation and role checks.
- Upgrade the supported framework versions.
- Isolate module refreshes and defer closed history panels.
- Prevent duplicate submissions.
- Reduce duplicate database work and add indexes.
- Add automated checks for critical rules.
- Show used ropes under excavators to masters and allow direct evacuation with history.
- Add ground tooth stocks per location, partial unload from bins, install/load/evacuate actions.
- Add partial rope unload from turntables.
- Add rope loans with optional recipient and optional turntable.
- Split loaded and empty turntables and improve card hierarchy.
- Rename dictionaries and hide mechanic requests without deleting historical data.

## Decisions

- Direct evacuation of used rope under an excavator is available to masters and records an immediate write-off; other legacy write-off actions remain restricted.
- Mechanic request creation and status changes require boss or admin rights.
- All inventory quantities must be positive integers on the server.
- Public UI behavior and Russian labels remain unchanged unless needed for loading feedback.
- Used ropes are evacuated through the existing transactional action, with the operator choosing any quantity from one to the available stock.
- Tooth-bin and turntable cards show location first, then contents, container name, and actions. Bin timestamps remain secondary.
- Local implementation and verification only until explicit approval to publish.
- Schema changes are additive; `MechanicRequest` and its historical rows remain intact.
- Production deployment must not seed or replace the database and requires a stopped-process backup with checksum and before/after row counts.

## Local Review 2026-08-30

- Approved typography: self-hosted IBM Plex Sans for information, IBM Plex Sans Condensed for actions across all seven modules and login. No third font. Font licenses are included in public/fonts.
- Loaded containers have a pale green background; empty ones have a pale gray background, without additional state badges. Ropes occupy one line each; diameter text is half the size of the black length label.
- Tooth counts occupy separate lines, number first: green new teeth, red used teeth. Ground stock retains a distinct dashed boundary and location-first hierarchy.
- One operation menu can be open at a time. Visited forms stay mounted to preserve controlled and uncontrolled drafts. Native action details participate; ordinary content sections (history, PPE groups) remain independent. Navigation discards drafts; merely closing a menu never submits it.
- Unloading USED teeth at the 30-ton crane writes SCRAP history and removes them from stock; the existing undo action restores the selected quantity to the source bin. Elsewhere the same action transfers them to ground stock without changing their condition.
- scripts/reconcile-crane-teeth.ts is preview-only by default. It requires an explicit DATABASE_URL and, with --apply, an existing operator via --login. It zeroes only positive USED stock in the legacy crane-ground bin, appends RECONCILE_SCRAP rows, preserves all prior history, and is idempotent. It is NOT run during builds or page requests.
- Local review database backed up using SQLite VACUUM INTO: backups/review-before-ui-1788092225169.db. Ten hidden used teeth reconciled locally; all 22 pre-existing tooth history rows compared unchanged; one correction row added. A second application found no stock to reconcile.
- Browser functional tests use a separate copy, prisma/ui-regression-1788093615672.db, never the review or production database. Verified two rope lines, menu exclusivity and quantity/recipient draft retention, mobile tooth add, partial scrap and undo, and unload/install at an excavator leaving 3 new and 2 used teeth on the ground.
- Seven module routes checked at 390px and 1280px: expected information/action font roles, no page-level horizontal overflow or console errors. Closed native details can retain offscreen layout rectangles, so those are not treated as visible overflow.
- A pre-existing encoding test iterator was wrapped in Array.from to match the repository's ES5 TypeScript target; test semantics are unchanged.
- No production access, Git commit, push, or deployment during local review. Before deployment, inspect production reconciliation preview and back up its database independently; never upload these local SQLite files.

## Management Review 2026-08-30

- Approved bottom Management area replaces dictionary accordions with named buttons and native modal dialogs. It is after history in DOM and visual order; keyboard focus stays inside the dialog and returns to the trigger on close. Only one operation window/menu stays open. Closing retains drafts; a successful save resets that form and displays status inside the dialog.
- Rope: excavator creation, place administration for existing authorized roles, rope types, Excel export, and the existing restricted clearing tool. Teeth: bin/type administration and existing restricted clearing. Assembly: creation and horizons. Yakno: creation/removal and repair for existing authorized roles. PP: points and sectors for existing authorized roles. Safety: archive, with restoration still restricted. Summary: sharing. No empty Management area for a role without applicable actions.
- Shift/master may create excavators only (not edit/delete arbitrary locations), and add/archive rope types and Yakno boxes. These checks are server-side as well as in UI. Repair, general location administration, export, clearing, and other dictionaries keep their previous permissions.
- Rope type archival is transactional and rejects any positive non-WRITTEN_OFF stock, including loans. Yakno archival retains its existing installed-equipment guard and history snapshots. Duplicate active Yakno creation is rejected instead of silently resetting a box in repair.
- PP adds only nullable PpPoint.unloadingSectorId. The server validates an active sector belonging to an active point. One pointer per point enforces exclusivity. An old deactivation cannot clear a different sector chosen meanwhile; archiving its sector or point clears the pointer. Switching does not add PpMovement history or change quantity/material/lastChangedAt.
- Existing review database backed up to backups/review-before-management-1788107063897.db using VACUUM INTO. The new nullable column was applied without seed/reset. Fingerprints of all prior columns and rows in all 23 tables match before and after.
- Browser write tests ran only on prisma/management-ui-1788107063897.db. Created an excavator, Yakno, and rope type as shift; verified occupied Yakno deletion disabled, type choices exclude active stock/loans, draft retention, arrow switch/off and reload persistence. Test account role was changed only in the disposable copy to inspect existing storekeeper actions.
- All 25 management dialogs checked at 320px and 1280px: one open dialog, no horizontal overflow. PP rows also checked at 390px. Narrow-screen legacy Yakno columns were adapted after the pass found overflow.
- 16 automated tests pass, including isolated SQLite integration tests for archival/history preservation and PP selection. ESLint passes. Lucide icons added; ESLint root set explicitly to prevent parent-project plugin conflicts after local dependency installation.
- Still local only: no commit, push, production connection, or deployment. All databases and backups stay ignored by Git.

## Location Archive Review 2026-08-30

- Approved Start: local implementation only. Production and GitHub remain untouched until local approval. No new schema changes in this archive iteration: retain Location identities with isActive=false and append existing movement tables.
- Master can add/archive/restore places and excavators from Rope Management, without receiving general administrative, export or clearing permissions. Creating an archived name directs the worker to Archive instead of creating a duplicate identity.
- Archive preview lists effects and separate ground-rope/ground-tooth destinations, defaulting to leaving them in place. A server-generated inventory fingerprint is rechecked inside the same transaction as all writes. Concurrent changes require a new preview; repeated archive/restore requests do not duplicate movements.
- Installed ropes and saved PPE stay with the excavator. Turntables and physical tooth bins move with their contents to the canonical crane. Yakno boxes detach and retain their own/effective horizon; assemblies detach in place. PP equipment is cleared but sectors, quantities, materials and the selected unloading arrow remain unchanged. Outstanding loans retain their identity and stock.
- Loose stock may remain under the archived excavator or move to independently selected active destinations. It stays visible and operable; empty ground blocks disappear without deleting Location or history. Moving USED teeth to the crane through archive/ground transfer does not scrap them. Explicit ordinary bin unloading at the crane retains its previously approved scrap behavior.
- Occupied ordinary places, the canonical crane, unresolved legacy requests and inconsistent loose-stock placements are protected. Ground, bins, turntables, loans, installed stock, Yakno, assemblies and PP references are included in occupancy checks. Historical rows alone do not block archiving.
- Restoring preserves saved current values and never returns relocated property. Missing PPE rows now receive empty dates; runtime synchronization neither creates a named excavator nor reapplies historical import dates. Existing imported dates are untouched.
- Add/archive/restore and transfers append actor/time history in the relevant module. Archive events do not use destructive legacy undo. Conservative deviation: archive/restore establishes a cross-module boundary for legacy undo, because old multi-object snapshots can reattach property or duplicate stock. Earlier history remains visible but its undo buttons are hidden; new operations remain undoable normally. This can also block an unrelated older undo and should be refined only with dependency-aware undo, not weakened before deployment.
- Stale submissions cannot attach ropes, pens, Yakno or assemblies to an archived location. Old PPE forms cannot edit archived values.
- Visuals: PP arrows 3.5px stroke, active light green/inactive pale gray; powered Yakno green and unpowered gray; loaded backgrounds slightly greener; crane quantities black with units, ground-tooth quantity +2pt; summary body/rope measurements consistently 14px regular.
- Backup: backups/review-before-archive-1788110748571.db. Disposable browser copy: prisma/archive-ui-1788110748571.db. All 23 original review tables fingerprinted unchanged after browser testing. Never deploy either local database.
- Browser: archive, leave ground stock, partial transfer, occupied-place refusal, restore and preserved PPE date checked as shift. Seven routes checked at 320px and 1280px with no horizontal page overflow. One transient hydration warning occurred during immediate post-action navigation; a fresh all-route pass and a repeated archive/navigation flow completed without console errors. No claim that this transient warning was conclusively fixed.
- SQLite tests cover atomic rollback, stale preview, permissions, inventory/history/PPE preservation, separate destinations, no accidental scrap and later ground evacuation. No production connection, commit, push, seed or deployment performed.
- Final verification: 21 tests pass; production build, type checking and lint pass; git diff --check clean. Duplicate archived-name creation shows the specific Archive recovery message in the browser. Final server at localhost:3004 uses the unchanged review-e2e.db; all 23 table fingerprints match the pre-change backup. Disposable port 3005 stopped. Current review PID 11700, logs backups/archive-review.out.log and backups/archive-review.err.log.

## Local Phone Login 2026-08-30

- The production-mode local preview emitted a Secure session cookie on HTTP. Browsers can accept that on localhost but not on the LAN IP used by phones, so subsequent tab navigation returned to login.
- Added explicit AUTH_COOKIE_SECURE configuration. Production defaults to Secure; only the exact value false disables it. The ignored local .env.local opts out for the trusted local HTTP preview, while .env.example specifies true for HTTPS deployment. HttpOnly, SameSite=Lax, root path and 30-day lifetime stay unchanged. Never copy the local environment to production.
- Added three cookie-policy tests for production defaults, explicit local HTTP, and development HTTPS. No database or user/password changes.
- Automated browser access to the LAN IP was blocked by the browser client (ERR_BLOCKED_BY_CLIENT), so actual phone verification requires the user to sign in once again and switch tabs. Do not claim a physical-phone test.
- Verification: 24 tests and production build pass. Fresh UI sign-in on 127.0.0.1 followed by Tooth, reload, and Rope remained authenticated, with no console errors. This verifies the flow on loopback, not a physical phone. Local review restarted at port 3004, PID 15836, using review-e2e.db; logs backups/phone-login-review.out.log and backups/phone-login-review.err.log. No database content, passwords, production configuration or GitHub changes.

## Deployment Preparation 2026-08-30

- User approved publishing and updating the existing rapmas.ru server, prioritizing current quantities, conditions and locations. History is retained too. Remote passwordless SSH is unavailable; deployment requires the user's logged-in terminal, with read-only preflight first.
- Added scripts/deployment-data.cjs: consistent SQLite VACUUM INTO backup, integrity/reference checks, private backup directory, and exact hashes/counts of every existing column and row. Verification accepts additive schema only, refuses a different database path, altered backup, removed columns/rows or any changed existing values. Secrets and raw row contents are not printed or included in the manifest.
- Backup is taken and verified before schema changes. Never seed, reset, transfer a local database/environment, or run the optional crane reconciliation on production. Preserve server environment and previous commit for rollback; check the actual PM2 database override before choosing the file.
- Deployment guard tests cover additive schema, modified quantities/locations/status/dates, inserted/deleted rows, backup tampering, missing database and overwrite protection. No production modifications yet.

## MAX Shift Reports Preparation 2026-09-05

- User requested sending the completed shift's changes to MAX daily at 08:00 and 20:00. Draft assumption: Asia/Yekaterinburg, day 08:00-20:00 and night 20:00-08:00, all workers and all six history tables (Summary has no independent history).
- Added read-only report collection and local preview CLI. Half-open timestamp intervals prevent a boundary event from appearing in both shifts. No UI history row limits. Information includes actor, time, action and saved movement details; long text splits under MAX's 4,000-character limit without dropping content. Legacy Yakno JSON snapshots become human-readable names and saved power state.
- A preview from local review-e2e.db for 2026-08-30 produced 70 history rows in four messages. The local database SHA-256 matched before/after. No production access, schema changes, sending, Git commit or deployment in this preparation.
- Pending: user has been asked whether an existing MAX bot is available; recipient chat/user, report format and no-change policy still need resolution. Do not enable sending until an explicit recipient and credentials are configured. No scheduler installed yet.
- Official docs checked: https://dev.max.ru/help/chatbots and https://dev.max.ru/docs-api/methods/POST/messages. Bot creation currently requires a verified organization, entrepreneur or self-employed profile. Current API base is https://platform-api2.max.ru, token in Authorization header, at most two messages/second per destination. Keep TLS validation enabled; any required CA must be scoped to the sender and reviewed before installation.
- Next implementation should use a server timer independent of the user's computer, durable frozen report parts, per-period/destination delivery records and concurrency protection. Ambiguous transport failures need reconciliation; do not promise exactly-once delivery without API idempotency support. Start catch-up from activation, not the entire historical database.
- Existing undo removes corresponding history rows; this draft mirrors history available at report time. PP unloading-arrow clicks deliberately have no history and are absent from reports. Later undo after delivery cannot silently rewrite an already sent report. Clarify any change to these semantics separately.

## MAX Connection Preparation 2026-09-16

- User has registered as self-employed; the MAX partner profile is not verified yet. Verification via Gosuslugi and bot moderation are user-side prerequisites. No token or recipient has been supplied.
- Added lib/max-api.ts and scripts/check-max-bot.ts. The check only calls GET /me, prints selected bot identity fields, and never sends messages. It accepts MAX_BOT_TOKEN or a private token file outside the repository; do not put tokens in command arguments, screenshots or tracked files.
- API origin is fixed to https://platform-api2.max.ru. TLS validation remains enabled, redirects are rejected, errors do not echo provider payloads or credentials, and requests time out after 15 seconds. Exact int64 string recipients are validated; unsafe numeric response IDs are rejected rather than rounded.
- Message and subscription primitives have no automatic retry. Ambiguous POST outcomes must be reconciled before resending. The eventual durable sender must pace messages at least 600 ms apart and require an explicitly approved recipient.
- Official docs rechecked: GET /chats is no longer supported as of June 2026. Discover the intended destination via signed bot_added/bot_started webhook events and explicit selection, not by taking the first available chat. Subscription uses X-Max-Bot-Api-Secret; webhook handler and scheduling remain to be implemented.
- No production changes, database changes, live MAX calls, subscriptions, scheduler, Git commit or deployment. Mock API tests cover authentication, recipient validation, plain-text sending, error redaction, ambiguous outcomes and subscription constraints.
- Verification: all nine focused report/API tests pass, TypeScript no-emit check passes, ESLint on the three new API/check/test files passes. Real credentials and MAX connectivity have not been tested.

## MAX Report Interview 2026-09-16

- Agreed contract and implementation/verification plan saved in docs/max-shift-report.md. This supersedes the original all-six-histories transcript draft: two blocks, PP state plus condensed operational results; PPE/fire extinguishers excluded for now.
- PP inclusion is ground OR excavator; within an included PP, retain zero sectors and their material letters, and show a green marker for the active unloading sector. Other excludes unchanged excavators and dictionary/configuration changes. Omit individual event times, actors and rope diameter.
- Compress intermediate container loading/delivery, but retain separate completed jobs, later empty-container relocation and used-rope evacuation. Power connections report first and final sources. Include loans/returns and ground-tooth operations.
- User confirmed Yekaterinburg 08:00/20:00, reports even with no events, and sending saved reports after MAX recovers. Freeze PP state with prepared text; do not rebuild delayed messages from next-shift data.
- Read-only source inspection identified necessary operation/container IDs and Yakno snapshots. Some legacy tooth MOVE actions distinguish loading from relocation via their structured fields. PP active unloading is not historically audited, so exact missed-boundary snapshots cannot be invented after full server downtime.
- This pass only records requirements and a proposed plan; no report implementation, database mutation, tests, Git publishing, bot message or production change was performed.

## MAX Local Report Implementation 2026-09-16

- User approved local implementation after the interview. No Git commit/push, production access, live MAX request, subscription or scheduler was performed. Partner profile is now verified; the bot was created, with moderation still pending in the last screenshot. Credentials and the exact approved group remain unavailable.
- Replaced the history-transcript draft with a pure structured formatter/reducer and a separate read-only Prisma collector. PP filtering is ground OR excavator, retains zero-sector materials and marks the active sector. Other contains operational results only, without actors, event times, diameters, PPE or extinguishers.
- Container compression matches item, holder, location and quantities. Intermediate load/delivery lines shrink or disappear only as subsequent work consumes their cargo. Separate installations, empty movements, evacuations and loans/returns survive. Multi-rope movement rows are combined only within a single recorded operation, after partial-quantity reduction.
- Tooth-bin cargo is recovered by rewinding current stock through recorded deltas, including post-shift movements. Unknown adjustments stop matching conservatively and keep possibly independent movement lines, with a local warning. No database history is deleted for report shortening.
- Power uses the first and final source snapshots. A round trip back to the same power source produces no net-change line. This does not suppress completed rope/tooth work. Late PP previews are explicitly dated rather than presented as exact historical boundary readings.
- Deviation discovered in the source: assembly power/unpower did not create history. Added a small transactional helper that preserves the existing inventory transition and appends before/after POWER audit to the existing table. No schema change or historical backfill. UI shows readable connection history, not the machine snapshot. Tests cover idempotence, reassignment, repair guard and complete rollback.
- Local JSON snapshots freeze the original period, capture time and final message text. Durable outbox, webhook recipient approval, delivery reconciliation, rate limiting and server scheduling remain the next implementation stage; none are implied by the snapshot helper.
- Four synthetic review examples are generated in ignored outputs/max-report-review-v2/REVIEW.md. A separate read-only preview of review-e2e.db for 2026-08-30 also succeeded. Its SHA-256 remained 6E0364CDEFB37ACF15EE68DD9C33C60214012DDB36ABD1A526EA580922000DD2. Tests write only disposable isolated databases.
- Final verification: all 47 tests pass, production build/type checking passes, focused ESLint passes and git diff --check reports no whitespace errors. The existing multiple-lockfile workspace-root warning remains; no unrelated build configuration was changed. Review database hash also matches after the build. Live MAX connectivity, delivery retries and a physical-phone flow were not tested in this report-only pass.

## MAX Group Connection Pending

- User approved the local report examples, confirmed bot moderation is complete and said the bot has already been added to the group named "Главный карьер". This is the intended recipient, but the exact chat ID has not yet been verified. Never select a destination by taking the first chat or by name alone.
- Prepared an empty credential file outside the repository at C:/Users/Sergey/AppData/Local/RaportMaster/secrets/max-bot.token. After creation, the file itself received a protected Windows DACL allowing only the current Sergey account and SYSTEM, without inherited sandbox-group access. Do not read or print its future contents in tool output, screenshots, chat, logs or commits; use scripts/check-max-bot.ts with --token-file for a read-only GET /me check after the user fills it. If its restricted ACL blocks the sandbox, request an elevated read-only check rather than making the token broadly readable.
- No token has been received or checked. No actual MAX API call, message, Git publishing or production modification occurred during this connection-preparation step.

## MAX Token Entry Recovery 2026-09-16

- The user could not open the credential path in Explorer or Notepad despite backend metadata confirming its presence and permissions. The exact filesystem/UI mismatch is unconfirmed. Repeating the file-link instructions did not resolve it, so token entry now uses a narrowly scoped local password form instead.
- Added scripts/setup-max-bot.ts, scripts/max-setup.html and lib/max-setup.ts. The helper binds only to 127.0.0.1 on an available port, expires after 30 minutes, checks Host/Origin/session nonce, limits request size/attempts/concurrency, rejects a different bot username and refuses replacing a filled credential file. It exposes no credential-reading route and does not log request bodies or provider errors.
- A successful check uses GET /me only and preserves the protected token file's ACL when filling the existing empty placeholder. The form never sends group messages or enables the report schedule. The approved human group name is displayed, but its chat ID is still not discovered or approved.
- Initial unauthenticated MAX connectivity checks failed with UNABLE_TO_GET_ISSUER_CERT_LOCALLY, including with existing Windows trust. Official MAX documentation requires the Russian Trusted CA. Downloaded the root via certificate-validated HTTPS from https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt into ignored backups/max-russian-trusted-root.crt. SHA-256 certificate fingerprint D2:6D:2D:02:31:B7:C3:9F:92:CC:73:85:12:BA:54:10:35:19:E4:40:5D:68:B5:BD:70:3E:97:88:CA:8E:CF:31; CA=true; expires 2032-02-27. Applied NODE_EXTRA_CA_CERTS only to the helper process, not Windows or global environment. TLS validation remained enabled; an unauthenticated GET /me then returned the expected 401.
- Verification: all 52 tests pass; TypeScript and focused ESLint pass. Headless Edge checked 1280px and 390px renders, loaded avatar/fonts, no horizontal overflow or page errors, masked input, cleared/disabled successful input and exactly one mocked save. Screenshots use no real token and are in outputs/max-setup-review. Mechanical style check is clean. Visual review was performed in-thread; no separate reviewer tool was available.
- Live helper started hidden with PID 14260 at http://127.0.0.1:62397, expiring 2026-09-16T17:53:59Z. Its ignored backups/max-setup-live-*.json status contains only public bot identity/status, never the token. Opening was requested in Codex; actual user entry/verification is still pending. After the user enters a real token, do not screenshot/read the form or dump the credential file. Inspect only the sanitized status, then stop the helper after confirmed completion.
- No Git publishing, production access, inventory/schema changes, real authenticated MAX request or group message occurred before this handoff. The only live API calls so far were unauthenticated connectivity checks.

## MAX Connection Verified 2026-09-16

- User confirmed token entry was complete. The sanitized setup status confirms the expected bot identity; the token itself was not printed, opened in an editor or captured in a screenshot. The temporary token-entry helper has stopped.
- Added narrowly scoped read-only MAX methods and scripts/inspect-max-group.ts. It checks the expected bot ID/username, refuses development discovery while any webhook is active, reads only the latest bot_added events with timeout=0 and no marker advancement, strips payloads, checks matching active group metadata and checks the bot's own membership. No chat-list endpoint, message history query, permission change, subscription mutation or send is performed.
- Live inspection found one active group matching the user-supplied name "Главный карьер", with 11 participants. Bot membership is active and isAdmin=false. Exact chat ID and public bot identity are retained in ignored backups/max-group-inspection-20260916.json as candidateOnly=true; they are not active sender configuration. Sending a brief connection-test message requires the user's next approval. Scheduling is still disabled and durable delivery storage is still to be implemented.
- Used the existing process-scoped official CA for TLS validation, without global certificate/environment changes. Focused API/setup tests (12), TypeScript and ESLint pass. No production, Git publishing or inventory changes in this verification step.

## MAX Approved Test Send 2026-09-16

- User explicitly approved one connection-test message to the verified group. The exact approved text was sent once after fresh GET /me and GET /chats/{id} identity/destination checks. MAX returned a confirmed message ID at 2026-09-16T18:30:25Z. User-visible receipt has not yet been confirmed.
- Ignored backups/send-approved-max-test.ts writes an exclusive, flushed attempt journal before its one POST, never retries automatically, and refuses rerunning when that journal exists. The result in backups/max-test-send-20260916.json is status=sent, messagesSent=1, scheduleEnabled=false. Do not rerun or delete the journal to repeat this approved test.
- Credentials were loaded only inside the process; no token appeared in output. The existing process-scoped verified CA was used with TLS validation enabled. No production access, Git publishing, inventory change, recipient-permission change, webhook subscription or schedule activation occurred.
- Sending to the fixed confirmed chat succeeded while isAdmin=false; no additional administrator privileges are currently justified for outbound messages. The eventual fixed-destination outbound sender need not poll updates or read group conversations. Durable delivery storage and server scheduling remain pending, not fulfilled by this one-shot test.

## MAX Durable Delivery Local Implementation 2026-09-16

- User confirmed seeing the approved connection-test message in the group. No further live message, production access, Git publishing, schedule activation or credential read occurred during this implementation.
- Added a separate SQLite outbox using the existing Prisma runtime, without changing the inventory schema or adding a dependency. Initialization is exclusive and disabled by default. Reopening validates the exact outbox tables, version and approved bot/group identity; inventory files are rejected. Source/outbox aliases and hard links are rejected by the CLI. Frozen messages, warnings, shift cursor and part state persist independently from operational data.
- Added read-only collection plus serialized delivery worker, explicit activation/pause/status/inspection and manual reconciliation CLI, and a separate opt-in PM2 process definition. First activation starts at the next Yekaterinburg 08:00/20:00 boundary. Restart/resume preserves pending work and catches up from activation, not the entire historical database. No continuous MAX polling, webhook or additional bot admin privileges are needed for this fixed destination.
- Transient GET/preflight failures wait safely; confirmed 429 rejections back off. Uncertain POST/crash outcomes are held for manual review, never blindly retried. Later sending pauses but future snapshots continue to be captured. Prepared parts and cursor commit atomically, worker claims serialize under SQLite, and rate limiting is persisted. Confirmed parts remain sent after restart. No exactly-once delivery claim is made.
- Deviation: SQLite raw-query timestamp columns need explicit BIGINT declarations with this Prisma version; the first test run exposed failures after writing millisecond values into INTEGER columns. Changed only the new outbox DDL and added safe bigint conversion. All queue tests then passed. There are no deployed outbox files or migrations affected by this correction.
- The generic worker error output is intentionally redacted. Permanent failure and uncertain delivery require inspecting the private outbox and PM2 logs; an additional external alarm channel is not included. Full downtime still cannot reconstruct historical PP unloading markers; late snapshots remain visibly labeled as agreed.
- Operator documentation: docs/max-report-operations.md. Release and schedule activation remain a separate approval step after local verification.
- Verification complete: all 71 tests pass, including 17 new outbox/CLI tests; focused ESLint and the full production build/type check pass. The existing multiple-lockfile build warning remains unchanged. Local review-e2e.db SHA-256 before and after testing/build remains 6E0364CDEFB37ACF15EE68DD9C33C60214012DDB36ABD1A526EA580922000DD2. No real MAX calls were made by the worker tests. Linux/PM2 execution remains a deployment-stage check, not claimed by local Windows tests.

## MAX Release v1.8.0 Preparation 2026-09-17

- User explicitly approved GitHub publishing, the existing server update and schedule activation, with a clear first-bot release name. Selected v1.8.0, "первая версия с MAX-ботом". The remote still runs 4af04b5 with a clean worktree; the existing web process remains online during preparation.
- Added one optional, explicitly approved introduction before the first morning report. Text stays outside Git in a private operator file. It is frozen atomically as part 0 with the selected shift's report and uses the same ordering, durable confirmations and uncertainty controls. Registration is possible only before first activation; a missed approved morning fails closed. No introduction is automatically sent during setup or on later shifts.
- Server time check at 2026-09-16T19:03Z corresponds to 00:03 on September 17 in Yekaterinburg. Intended first report and introduction: 2026-09-17T08:00:00+05:00. No production inventory/schema changes are needed for the report outbox. Fresh on-server backup and exact-value verification remain required before updating the web process.
- The complete local suite now passes 74 tests, including one-time introduction ordering, repeated shifts, restart, missed-time refusal and reconciliation of uncertain part 0. Existing operational regression tests also pass. Final build and server-side rehearsal are performed before production activation.

## Local Schedule And Power Review 2026-09-19

- Scope approved: final 20:00 report today, next 06:30 tomorrow, then 06:30/19:30; contiguous reporting periods. Shorter header and Changes heading. One approved warning before the final old report. No Git publishing, production access or actual MAX sending in this local stage.
- Assemblies: powered excavator first, smaller horizon second, assembly identity/length below; shared cargo green, separate powered/unpowered groups, repair in the unpowered group. Available working assemblies can connect without an already-set horizon: use the excavator's known horizon, or select an assembly horizon in the form.
- Critical clarification: assemblies NEVER change Yakno state or history. A single assembly serves one excavator. Selecting a busy assembly is rejected until disconnected. Yakno and assembly changes are also reduced independently in reports.
- Yakno edit menu: all active, unrepaired, unpowered boxes available across horizons, plus the current connection; occupied boxes excluded. Current-horizon boxes are read-only information, not checkboxes. Legacy unpowered assignments become available without any bulk data migration. Only an explicit new power/move action changes stored values. Disconnecting leaves the old horizon unchanged.
- Extracted transactional Yakno helper with stale-form checks and occupied-box validation. Move plus connection and audit are atomic. Undo checks the saved after-state and occupancy before restoring; it refuses to overwrite later changes. Existing history is not backfilled.
- Inventory schema is unchanged. Explicit paused outbox migration adds schedule settings only; immutable parts, confirmations and snapshots are untouched. Transition notice is frozen as part 0 and shares existing delivery/uncertainty controls.
- Deviation: a migration test exposed Prisma's cached SELECT-star metadata after ALTER TABLE. Settings reads now name stable and version-2 columns explicitly. A failed migration is tested to roll back both added columns and cursor changes.
- Conservative choice: selecting a horizon for an excavator with no known horizon sets the assembly location only. It does not mutate the Yakno-owned excavator state, in accordance with the explicit independence requirement.
- UI and functional review use a NEW copy in ignored outputs/power-review-20260919, plus marked synthetic records. The original local review DB was hash-checked unchanged. Production inventory is not copied to this machine.
- Tests: all 87 unit/integration cases pass, including real concurrent Yakno claims, stale assembly disconnect, queue migration rollback, pending-review preservation and consecutive transition periods. Focused ESLint and the final production build pass.
- Visual QA found an existing 170px minimum on free-Yakno buttons overflowing their half-width cards at 320px; scoped sizing now lets these controls fit the grid. Power menus close only after success, remain open on errors, and use the existing bottom-sheet presentation on narrow screens. Font inspection confirmed actual custom IBM Plex Sans Condensed for headings/actions and IBM Plex Sans for horizon information.
- Impeccable detector ran once on the changed UI: only the pre-existing Arial declaration in styles.css:349 was flagged. It was outside this change and was left alone. No global typography redesign or asset replacement was introduced.
- Final browser checks passed on the production build in headless Edge: assembly/Yakno operations, data independence, occupied/repair exclusions, successful-menu closure, exclusive menus, and five routes at 320/390/1400px without horizontal overflow. Screenshots and ui-check.json are in ignored outputs/power-review-20260919. Earlier runs intermittently reported React hydration error 418; the development diagnostic and the final complete run (waiting for navigation readiness before interactions) were clean. A product-level root cause was not established; watch for recurrence during manual review rather than claiming it was repaired.
- Summary now treats all unpowered Yakno as free, consistently with the new selector; old unpowered excavator associations are no longer presented as current connections. Stored records are unchanged until an explicit operation.
- Local review server: http://127.0.0.1:3005/assembly, separate marked fixture data. The original prisma/review-e2e.db hash is still 6E0364CDEFB37ACF15EE68DD9C33C60214012DDB36ABD1A526EA580922000DD2. No deployment or schedule activation has occurred.

## Release v1.9.0 Approval 2026-09-19

- User reviewed the separate local preview, accepted the result and explicitly approved GitHub publication and the existing production-server update. Release name: v1.9.0, "сборки, ЯКНО и новое расписание MAX".
- Fresh read-only server check at 11:42 UTC: previous v1.8.0 checkout is clean, web and report worker are online, six report parts are confirmed sent, no attention items. The next boundary is today 20:00 Yekaterinburg, so the approved transition is still in the future.
- Deployment gates: rehearsal against an on-server inventory copy; pause/stop worker; fresh consistent inventory and outbox backups; exact inventory comparison before web restart; preserve all frozen reports and confirmations through the explicit outbox schedule migration; no seed, reset, database replacement, credential transfer or extra test message.
- Detailed actual deployment results will be recorded separately in the ignored operator journal. This approval record is not a claim that deployment or transition activation has already completed.

## Prior UI Deviations

- Данные СИЗ и огнетушителей перенесены из документа «Рапорт мастера новая версия сиз+ огнетушители (1).docx». Для ЭКГ-10 №9 создаются строки СИЗ без дат; номера его огнетушителей пока неизвестны и будут добавлены после получения данных.

- 2026-08-02: The tooth summary was moved below the 30-ton crane and foam-bin blocks. The change affects presentation only; inventory calculations and movement rules remain unchanged.

- 2026-08-01: Повторяющийся сбой добавления зубьев оказался не мобильной проблемой, а скрытым повреждением кодировки строк в `app/actions.ts`. Вместо точечной замены одного имени выполняется проверяемое восстановление всех однозначно поврежденных строк этого файла, чтобы устранить аналогичные несовпадения в канатах, зубьях и сборках.

- The application code is prepared for the Next.js 15 async request APIs, but the package archive download is blocked in the current managed environment. The tested local dependency set remains Next.js 14.2.35 and React 18.3.1.
- The npm security advisory endpoint is blocked in the current managed environment, so `npm audit` could not return advisory data.
