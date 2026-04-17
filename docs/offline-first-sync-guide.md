# Offline-First Sync Guide (Off-Grid)

Use this strategy for all Root Record client apps while the server can be offline.

## Core Rule

- Never block writes when server is unreachable.
- Save locally first, then sync to server when online.

## Minimum Client Data Model

- `local_event_id` (uuid, unique)
- `entity_type` (e.g. user, invoice, note)
- `entity_id` (stable id)
- `operation` (`create`, `update`, `delete`)
- `payload_json`
- `created_at_utc`
- `synced_at_utc` (null until synced)
- `sync_attempts`
- `last_error` (nullable)

## Sync Flow

1. Write user action to local queue immediately.
2. Try background sync every N seconds with exponential backoff.
3. Send idempotency key = `local_event_id`.
4. Server stores processed keys to avoid duplicate replays.
5. Mark local row as synced only on confirmed success.

## UX Copy Recommendation

- Show banner when offline:
  - "Server offline (off-grid). Changes are saved locally and will sync automatically."
- Show queue count:
  - "Pending sync: X"

## Conflict Policy (V1)

- Use `updated_at_utc` and default to last-write-wins.
- Write conflict events to an audit table for later review.

## Server API Expectations

- Endpoint should accept batched events.
- Endpoint should return per-event status (`ok`, `retry`, `conflict`, `reject`).
- Endpoint should be idempotent by `local_event_id`.

## Backup Coordination

- Local clients should export queue snapshots periodically.
- Server should run scheduled DB backups from Operations Hub.
