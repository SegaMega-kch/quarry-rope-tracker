# Implementation Notes

## Scope

- Harden server-side validation and role checks.
- Upgrade the supported framework versions.
- Isolate module refreshes and defer closed history panels.
- Prevent duplicate submissions.
- Reduce duplicate database work and add indexes.
- Add automated checks for critical rules.

## Decisions

- Rope evacuation, rope write-off, tooth write-off, and tooth scrap require boss, storekeeper, or admin rights.
- Mechanic request creation and status changes require boss or admin rights.
- All inventory quantities must be positive integers on the server.
- Public UI behavior and Russian labels remain unchanged unless needed for loading feedback.

## Deviations

- The application code is prepared for the Next.js 15 async request APIs, but the package archive download is blocked in the current managed environment. The tested local dependency set remains Next.js 14.2.35 and React 18.3.1.
- The npm security advisory endpoint is blocked in the current managed environment, so `npm audit` could not return advisory data.
