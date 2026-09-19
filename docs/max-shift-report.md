# MAX Shift Report: Agreed Contract

This contract supersedes the original full-history draft. Requirements were clarified with Sergey using finding-unknowns. Version 1.8.0 was deployed and activated on 2026-09-17. The 2026-09-19 changes below are a LOCAL candidate; production remains unchanged until separate review and deployment approval.

## Delivery

- Send to one explicitly approved shared MAX group, not to arbitrary bot users or other groups.
- After an explicit transition, daily at 06:30 and 19:30, Asia/Yekaterinburg (UTC+5).
- Final old report: 2026-09-19 08:00-20:00. First new report: 2026-09-19 20:00 through 2026-09-20 06:30; then 06:30-19:30 and 19:30-06:30. Use half-open event intervals [start, end), continuously from the previous boundary.
- Header contains only the original date and period, without "Рапорт мастера" or "(Екатеринбург)". Event lines omit individual times and worker names.
- Send even without operational events; retain the PP state block and say that the shift had no changes in the Other block.
- If MAX is unavailable, persist the prepared report and send it after recovery with its ORIGINAL period. Never replace it with the next report or rebuild its PP state from the next shift.
- No live sending until credentials, destination identity and recipient approval are established. No production activation during local review.

## Block 1: Ground At PP

- Show a PP if it has any ground/material quantity OR an assigned excavator. Omit it only when both are absent.
- Visually separate individual PPs and show the excavator name, or indicate that no excavator is assigned.
- Within a displayed PP, show ALL active sectors, including zero quantities. Preserve the material letter for both zero and non-zero readings: ore or overburden, as in the app.
- Mark the currently selected unloading sector with the green-circle symbol U+1F7E2. No inactive symbols on the other sectors.
- If an excavator is present with no ground, indicate no ground, but still retain zero-sector readings and their material types. The earlier proposal to hide zero sectors was explicitly superseded.
- This block is a current-state snapshot at report preparation, not a transcript of PP adjustments during the shift.

## Block 2: Changes (ИЗМЕНЕНИЯ)

- Include operational changes during the shift only. Group excavator-related results by excavator; keep container movements readable when they do not belong under an excavator.
- Do not list unchanged excavators outside PP just to show their location.
- Include rope installation/replacement, used-rope evacuation, loaded and empty turntable movements, unloading and operational rope movements, loans and loan returns.
- Include tooth-bin loading, movement, unloading and tooth installations. Ground-tooth installation, loading into a bin and evacuation are included too.
- Include working changes involving assemblies and Yakno power connections, showing the disconnected Yakno as well as the final connection where applicable.
- Omit dictionary and application-configuration changes. Do not report every click or database row as separate work.
- Omit PPE and fire extinguishers entirely for now, including remedied expiry issues. Keep a disabled extension point for future PPE expiry reporting; do not enable it silently.
- Rope text omits diameter. Show purpose and length where known; retain quantity where it matters, such as loans or evacuation. Do not invent a rope purpose that cannot be derived reliably from stored data.

## Compression Rules

- Loading a container, delivering it and installing its contents form a chain. When installation completes that chain, show the installation instead of repeating the intermediate loading and delivery.
- Do NOT implement a global "last row per container" filter. If one bin/turntable serves two excavators in a shift, retain both completed installations.
- A subsequent empty-container movement is an independent result and must not hide an installation. Used-rope evacuation is also independent and must remain visible.
- Preserve unrelated contents, partial quantities and completed work when compressing a chain. Suppress only provably superseded intermediate steps.
- For multiple Yakno reconnections of one excavator, show its starting and final connections, not intermediate sources. Example: 7 -> 8 -> 12 becomes 7 -> 12.
- Assembly and Yakno are independent connections. Do not summarize one disconnect and the other's connection as "Yakno -> assembly". Disconnecting an assembly leaves the Yakno connection untouched.
- Exact phrasing should stay short, factual and readable. Where legacy history lacks reliable data, avoid fabricating historical quantities, power states or locations.

## Implementation And Remaining Delivery Work

1. Separate the read-only source collector, structured report model, deterministic compression and message formatting. Keep source action IDs, object IDs, timestamps and operation IDs internally even though they are not displayed.
2. Capture active PP sectors, equipment assignments and unloading markers consistently with the shift event read. Use a separate report snapshot/outbox for delivery bookkeeping; do not modify production inventory or delete history to achieve report compression.
3. Reduce container work as chains with completed-work boundaries and quantity-aware matching. Reduce power changes using before/after snapshots rather than text-only comparisons.
4. Produce local previews from fixtures and an explicitly selected local database. Show Sergey the final format and edge cases before publishing or activating sending.
5. Add durable prepared report parts, destination/period uniqueness, serialized delivery and rate limiting. Keep uncertain POST outcomes separate from confirmed rejection; do not blindly retry a message that might already have been accepted.
6. After local approval, publish through GitHub, take a fresh on-server backup and verify existing data preservation, deploy, configure the approved group securely, run an approved test and then activate the schedule.

Steps 1-6 were completed for v1.8.0 on September 17. Step 2 uses a consistent read transaction and a separate SQLite outbox containing immutable prepared messages, original period, capture time and delivery state. Development tests use fake MAX responses. The September 19 schedule/format changes still require local review and separate deployment approval. See max-report-operations.md for transition gates and recovery; the mere presence of new code does not activate the new schedule.

## Local Review

- Run `scripts/preview-shift-examples.ts --output-dir <new-directory>` with tsx to create four synthetic examples and REVIEW.md. Files are created exclusively; existing examples are never overwritten.
- Run `scripts/preview-shift-report.ts --database <existing-local-db> --at <ISO-time-with-zone> --output <new-text-file> --snapshot <new-json-file>` with tsx for an explicit read-only database preview. It never seeds, migrates or sends a report.
- The reviewed synthetic examples are in ignored outputs/max-report-review-v2. They cover ordinary work, no-change shifts, repeated completed jobs and partial installations.
- Actual local preview for 2026-08-30 was produced from prisma/review-e2e.db. The PP block explicitly states its current capture time, because no boundary snapshot was saved in August. The database SHA-256 is unchanged before/after the read.
- One physical multi-rope turntable movement is combined using its operation ID after quantity-aware reduction. Similar-looking rows from independent trips or completed installations are not deduplicated.
- New assembly power/unpower/reassignment actions now append POWER history transactionally, with machine-readable before/after snapshots and readable UI history. Existing schema and old rows are unchanged. Pre-existing unlogged connections cannot be reconstructed and are not invented.

## Technical Findings And Residual Risks

- Rope history stores operationId, fromTurntableId/toTurntableId, locations, quantities and stock attributes. One physical turntable move may create multiple history rows and must not generate duplicate movement lines.
- Tooth history stores bin/from-bin/to-bin IDs, locations, quantities and installation excavator. Legacy loading and whole-bin relocation can both use action MOVE; distinguish them using structured fields, not a blanket action filter or arbitrary comment text.
- Yakno history has beforeState/afterState snapshots, including legacy snapshots in text fields. New assembly connection history is parsed separately from its assembly-power-v1 snapshot. Old assembly connections without audit records remain unavailable.
- PP unloading selection is deliberately not event-audited. A stored report snapshot can be resent unchanged, but after a full server outage at the boundary a historical unloading marker cannot be reconstructed reliably. Do not label a later current snapshot as exact historical PP state. Surface missing snapshot time honestly.
- Existing undo may remove event rows. An already delivered or frozen report must not be silently regenerated to different content. Report collection reflects history available when the snapshot is prepared.
- A closed-loop power change that ends on its starting source produces no net power-change line, rather than a source-to-same-source arrow. This is covered by tests; if it is the only event, the Other block says there were no changes. Actual completed rope/tooth work is never discarded based on equal final state.
- Bot moderation and initial connection checks were completed for v1.8.0. Identity and membership were verified without granting administrator rights. Private destination/configuration values remain outside Git. Operational deployment records, not these historical checks, determine the current live status; this local update does not contact the group or change its settings.

## Minimum Preview/Test Cases

- Empty PP without an excavator omitted; PP with an excavator and zero sectors retained; non-zero PP without an excavator retained.
- Zero ore and zero overburden shown correctly; only the active sector has the green marker.
- Multiple modules, no timestamps/actors, no diameters, no PPE/extinguishers or dictionary noise.
- Load -> deliver -> install becomes one result; two independent installation cycles retain two results.
- Installation plus empty-container removal plus used-rope evacuation retains all three outcomes.
- Partial installation from a two-rope turntable does not hide the remaining rope's delivery or later work.
- Ground-tooth actions, loans and returns preserve counts and destinations.
- Reconnection 7 -> 8 -> 12 displays 7 -> 12 and retains the original disconnected source.
- No-change shifts still produce reports; long reports split safely without breaking a PP or event unnecessarily.
- Prepared text and original period remain unchanged when source data changes. Separate outbox tests now cover delivery failure, concurrency, restart, partial delivery, transaction rollback and manual reconciliation; these are simulated local tests, not production fault injection.
