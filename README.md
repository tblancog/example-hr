# examplehr-time-off — ExampleHR Take-Home Exercise

A NestJS + TypeORM microservice that manages employee time-off requests with HCM (Human Capital Management) integration.

---

## Quick Start

**Requirements:** Node.js ≥ 18, pnpm ≥ 9

```bash
pnpm install
pnpm start              # starts on http://localhost:3000
```

**Environment variables** (all optional with sensible defaults):

| Variable         | Default                 | Description                                     |
| ---------------- | ----------------------- | ----------------------------------------------- |
| `PORT`           | `3000`                  | HTTP port                                       |
| `HCM_BASE_URL`   | `http://localhost:3100` | HCM system base URL                             |
| `HCM_TIMEOUT_MS` | `5000`                  | HCM request timeout in ms                       |
| `NODE_ENV`       | _(unset)_               | Set to `production` to disable auto-sync schema |

---

## Running Tests

```bash
pnpm test               # all suites (unit + integration + e2e)
pnpm test:unit          # unit tests only
pnpm test:integration   # integration tests with in-memory SQLite + HCM mock
pnpm test:e2e           # end-to-end HTTP tests via supertest
pnpm test:coverage      # all suites with coverage report
pnpm typecheck          # TypeScript compilation check (no emit)
```

Coverage thresholds enforced on every run:

| Metric     | Threshold | Current |
| ---------- | --------- | ------- |
| Statements | 85%       | ~91%    |
| Branches   | 75%       | ~77%    |
| Functions  | 85%       | ~88%    |
| Lines      | 85%       | ~92%    |

---

## API Reference

### Time-Off Requests

| Method   | Path                             | Description                                                         |
| -------- | -------------------------------- | ------------------------------------------------------------------- |
| `POST`   | `/time-off-requests`             | Create a new PENDING request                                        |
| `GET`    | `/time-off-requests/:id`         | Get a request by ID                                                 |
| `GET`    | `/time-off-requests`             | List requests (filter by employeeId, locationId, status; paginated) |
| `PATCH`  | `/time-off-requests/:id/approve` | Approve a PENDING request (deducts HCM balance)                     |
| `PATCH`  | `/time-off-requests/:id/reject`  | Reject a PENDING request                                            |
| `DELETE` | `/time-off-requests/:id`         | Cancel a PENDING request                                            |

#### Create Request Body

```json
{
  "employeeId": "emp-001",
  "locationId": "loc-nyc",
  "startDate": "2026-06-01",
  "endDate": "2026-06-05",
  "type": "VACATION",
  "note": "Summer holiday"
}
```

`type` must be one of: `VACATION`, `SICK`, `PERSONAL`  
`note` is optional, max 500 characters.

#### Approve / Reject Body

```json
{ "managerId": "mgr-001" }
{ "managerId": "mgr-001", "reason": "Team coverage needed" }
```

#### List Query Parameters

| Param        | Type   | Default | Max |
| ------------ | ------ | ------- | --- |
| `employeeId` | string | —       | —   |
| `locationId` | string | —       | —   |
| `status`     | string | —       | —   |
| `page`       | number | 1       | —   |
| `limit`      | number | 20      | 100 |

### Balance

| Method | Path                                | Description                   |
| ------ | ----------------------------------- | ----------------------------- |
| `GET`  | `/balances/:employeeId/:locationId` | Get cached balance            |
| `POST` | `/balances/sync`                    | Pull latest balance from HCM  |
| `POST` | `/balances/batch-sync`              | Batch upsert from HCM nightly |

#### Batch Sync Body

```json
{
  "syncId": "nightly-2026-06-01",
  "balances": [
    {
      "employeeId": "emp-001",
      "locationId": "loc-nyc",
      "available": 10,
      "used": 2,
      "total": 12
    }
  ]
}
```

---

## Architecture & Design Decisions

### HCM as Source of Truth

Balance data is authoritative in HCM. Approvals always perform a real-time **GET → check → SET** cycle against HCM rather than trusting the local cache. This ensures the local database reflects what HCM has committed, not what we assumed at request-creation time.

### State Machine

```
PENDING → APPROVED   (balance deducted from HCM)
PENDING → REJECTED   (no HCM interaction)
PENDING → CANCELLED  (no HCM interaction)
```

All other transitions return `409 Conflict`. Once a request leaves PENDING it is immutable.

### Race Condition Prevention

Two serialization layers protect against concurrent operations:

1. **Create queue** — concurrent `POST /time-off-requests` for the same `employeeId:locationId` pair are serialized in-process to prevent overlap false-negatives.
2. **Approve queue** — concurrent approvals for the same `employeeId:locationId` are serialized in-process so the HCM GET → SET cycle cannot interleave. HCM's atomic SET is the cross-node safety net.

Both queues use a `Map<key, Promise<void>>` chain — zero dependencies, single-node guarantee.

### Balance Conflict Detection (Batch Sync)

When HCM's batch payload shows `available < pendingDays`, the system records a conflict with `resolution: HCM_WINS` and still writes the HCM value. The response includes the full `conflicts` array so the caller can notify managers.

### Idempotent Batch Sync

Re-posting the same `syncId` throws `409 Conflict`. The guard is an in-memory `Set` (fast-path for the same process instance). A production deployment with multiple instances would need a dedicated `ProcessedSyncIds` table with a unique index on `syncId`.

### Rate Limiting

`@nestjs/throttler` enforces 100 requests per 60 seconds per IP globally via `APP_GUARD`. Adjust `ThrottlerModule.forRoot` in `AppModule` for stricter per-endpoint policies.

### Authorization Design

`src/common/guards/roles.guard.ts` implements header-based role checking (`X-User-Id`, `X-User-Role`). In a production deployment the API gateway strips caller-supplied identity headers and injects verified ones after JWT validation. The guard is ready to be added to individual routes with:

```typescript
@UseGuards(RolesGuard)
@Roles('MANAGER')
```

The service layer enforces **self-approval prevention** regardless: `approve()` throws `403 Forbidden` when `managerId === employeeId`.

### Input Validation

- `ValidationPipe({ whitelist: true, transform: true })` strips unknown fields and transforms types globally.
- Registered via `APP_PIPE` (DI-aware) rather than `useGlobalPipes` in `main.ts` — avoids the double-registration bug.
- `note` field: max 500 characters.
- `limit` query param: capped at 100 to prevent unbounded table scans.

### Database

SQLite (via `better-sqlite3`) with TypeORM. Schema is auto-synchronized in non-production environments (`synchronize: process.env.NODE_ENV !== 'production'`). Production deployments should use explicit TypeORM migrations.

---

## Project Structure

```
src/
  app.module.ts              # Root module: TypeORM, ThrottlerModule, APP_PIPE, APP_GUARD
  main.ts                    # Bootstrap only — no duplicate pipes
  common/
    decorators/
      roles.decorator.ts     # @Roles(...) metadata setter
    enums.ts                 # TimeOffType, RequestStatus, SyncSource, SyncTrigger
    exceptions/              # Domain exceptions: HcmUnavailable, InsufficientBalance, InvalidDimension
    guards/
      roles.guard.ts         # Header-based role guard (X-User-Role)
    interfaces/
      repository.interfaces.ts  # IBalanceRepository, ISyncLogRepository, ITimeOffRepository
  hcm/
    hcm.service.ts           # Fetch wrapper with AbortController timeout
    hcm.module.ts            # HCM_CONFIG provider (baseUrl, timeoutMs from env)
  balance/
    balance.entity.ts        # Balance cache table
    balance.repository.ts    # findByEmployeeLocation, upsert, findPendingDays
    balance.service.ts       # syncFromHcm, checkAndDeductBalance, batchSync
    balance.controller.ts
    sync-log.entity.ts       # Audit trail for all balance changes
    sync-log.repository.ts
  time-off/
    time-off.entity.ts
    time-off.repository.ts   # findOverlapping, findByFilters with pagination
    time-off.service.ts      # create (with overlap queue), approve (with approve queue)
    time-off.controller.ts
    dto/                     # class-validator DTOs

test/
  unit/                      # Mocked dependencies, fast
  integration/               # Real SQLite in-memory, HCM mock HTTP server
  e2e/                       # Full NestJS app + supertest HTTP requests
  hcm-mock/                  # Configurable HCM mock server used by integration/e2e
```
