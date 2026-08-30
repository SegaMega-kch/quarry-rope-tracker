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

## Earlier Deviations

- Данные СИЗ и огнетушителей перенесены из документа «Рапорт мастера новая версия сиз+ огнетушители (1).docx». Для ЭКГ-10 №9 создаются строки СИЗ без дат; номера его огнетушителей пока неизвестны и будут добавлены после получения данных.

- 2026-08-02: The tooth summary was moved below the 30-ton crane and foam-bin blocks. The change affects presentation only; inventory calculations and movement rules remain unchanged.

- 2026-08-01: Повторяющийся сбой добавления зубьев оказался не мобильной проблемой, а скрытым повреждением кодировки строк в `app/actions.ts`. Вместо точечной замены одного имени выполняется проверяемое восстановление всех однозначно поврежденных строк этого файла, чтобы устранить аналогичные несовпадения в канатах, зубьях и сборках.

- The application code is prepared for the Next.js 15 async request APIs, but the package archive download is blocked in the current managed environment. The tested local dependency set remains Next.js 14.2.35 and React 18.3.1.
- The npm security advisory endpoint is blocked in the current managed environment, so `npm audit` could not return advisory data.
