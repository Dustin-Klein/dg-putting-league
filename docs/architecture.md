# Architecture Guide (Next.js + Supabase)

This document explains how the project is structured and how pieces interact.

## High-Level Flow

```
HTTP Request
  → API Route
    → Service
      → Repository
        → Postgres (Drizzle)
```

Dependencies flow **downward only**. No upward or sideways dependencies.

---

## Next.js Conventions

### Routing

- Use **App Router** (`/app`) where possible
- API routes live in `/app/api/*/route.ts`
- Each route should:
  - Parse input
  - Authenticate via Supabase
  - Call a single service entry point
  - Return a response

### Server vs Client

- Default to **server components**
- Use client components only for interactivity
- Never access Supabase service keys in client code

### Environment Variables

- `NEXT_PUBLIC_*` → browser-safe only
- `DATABASE_URL` → server-only direct Postgres connection used for all server data access (never `NEXT_PUBLIC_`); required in production (startup fails via `instrumentation.ts` if missing). In production, connects via Supabase Supavisor transaction pooler (port 6543, user `app_server.<project-ref>`, `?sslmode=require`). Local: `postgresql://app_server:app_server@127.0.0.1:54322/postgres`.
- `DATABASE_POOL_MAX` → optional maximum pool size for Drizzle connection (default: 3)
- Routes touching the DB must use the Node.js runtime (never Edge) due to TCP sockets
- No Supabase secret/service-role key is used; never add one to client code or a `NEXT_PUBLIC_*` var
- Fail fast if required env vars are missing

---

## Supabase Usage

### Trust Model & Clients

- The browser only authenticates (Supabase Auth) and subscribes to Realtime.
- Database roles `anon` and `authenticated` can only `SELECT` (governed by RLS policies). They cannot write to any table or execute business functions.
- Supabase is used only for **Auth** (sessions, sign-up, password reset) and **Realtime** (`postgres_changes` in client pages). Every server read and write goes through Drizzle as role `app_server` after an explicit service-layer authorization check. No secret-key Supabase client exists.
- `app_server` bypasses RLS, so RLS no longer filters server reads: each service read calls one of the authorization functions below. The read-only SELECT policies stay because Realtime and any direct browser read still go through them.
- The Drizzle connection (`lib/db/client.ts`) uses the `postgres` driver, is lazily created and cached on `globalThis`, and is type-branded as `Db`.
- Direct imports of `lib/db/client` are restricted by ESLint to `lib/services/auth/**`, `lib/db/**`, `integration/**`, and tests.
- Services obtain clients exclusively through authorization functions in `lib/services/auth/auth-service.ts`:
  - Admin: `authorizeEventAdmin` (loads the event and the user's league role in one query), `authorizeLeagueAdmin`, `authorizeLeagueOwner`, `authorizeAnyLeagueAdmin`, `authorizeLeagueCreation` return `{ user, pg }` (event admin also returns `event`). `requireEventAdmin` (event service) returns `{ pg, user }`.
  - Admin-or-public reads: `authorizeEventView(eventId, scope)` returns `{ user | null, event, isAdmin, pg }`. League admins may read their events; everyone else only when the scope is publicly visible, otherwise `NotFoundError` (private events don't reveal they exist). Scopes and rules live in `lib/services/auth/visibility.ts` and mirror the SELECT policies: `event` (bracket/completed, or pre-bracket with qualification), `bracket` (bracket/completed), `lanes` (bracket), `qualification` (pre-bracket with qualification).
  - Public reads of data that is public for every row (leagues, players without email, placements): `authorizePublicRead()` returns `{ pg }`; anything event-scoped must still pass a visibility check (in SQL, commented as mirroring `visibility.ts`, when filtering lists).
  - The user's own records: `authorizeAuthenticated()` returns `{ user, pg }`; query only by `user.id`. `getViewer()` returns the user or null.
  - Access codes: `authorizeAccessCode` returns `{ event, pg }`; reads and writes stay scoped to `event.id`.
  - Each performs its check before returning `pg`. Every service read has a unit test for the unauthorized case.

### Auth

- API routes must validate the session/user
- Never trust client-provided user IDs
- Derive user identity from Supabase auth context

### Database Access

- All queries live in `lib/repositories/*.db.ts` (Drizzle); there are no `supabase.from(...)` or `.rpc(...)` calls in `lib/`
- Repositories receive explicit IDs and parameters and take `ex: Executor` first
- Repositories return the JSON shapes PostgREST used to: convert `numeric` with `toNumber` and `timestamptz` with `toIsoTimestamp` (`lib/db/mappers.ts`)
- Column restrictions: never select `events.access_code` except in `getEventAccessCode`/`getEventByAccessCode`, never return `players.email`, and include `event_players.payment_type` only for admins
- Account emails come from `app_private.user_emails` (`lib/db/auth-schema.ts`), a view over `auth.users` (id, email) that only `app_server` can read

---

## Transactions & Locking (Drizzle)

- **Direct Postgres connection**: Server writes for transactional flows go through a direct Postgres connection with Drizzle ORM (`drizzle-orm` + `postgres` driver) in `lib/db/`.
  - `lib/db/client.ts`: Server-only, lazily creates and caches (on `globalThis`) the connection from `DATABASE_URL` with `prepare: false` and a small pool (`DATABASE_POOL_MAX`, default 3). Branded type `Db`.
  - `lib/db/tx.ts`: Provides `withTransaction(ex, fn)` (nested call → savepoint), `lockEvent(tx, eventId)` (`pg_advisory_xact_lock`, transaction-scoped and safe behind the transaction-mode pooler), `lockMatch(tx, matchId, eventId)` (`SELECT … FOR UPDATE`, scoped to event), and types `Db`, `Tx`, `Executor = Db | Tx`.
- **Transaction ownership**: Services own transactions (like Spring `@Transactional`). Repositories never open transactions.
- **Keep transactions short**: Keep transactions to DB work only; build response DTOs and read-backs after commit.
- **Repository convention (`.db.ts`)**: Repositories live in `lib/repositories/` with a `.db.ts` suffix (e.g. `lib/repositories/bracket-repository.db.ts`). Every function takes `ex: Executor` as its first parameter.
- **Lock order (prevents deadlocks)**:
  1. Event advisory lock (`lockEvent(tx, eventId)`)
  2. Event row (`getEventBracketConfig(tx, eventId, { lock: 'share' })`; `'update'` when changing the event). Holding it means the event can't be completed under a write that already checked its status.
  3. Match rows (`lockMatch(tx, matchId, eventId)`, ordered by ascending id)
  4. Lane rows (ordered by ascending id)
  - Any operation mutating bracket structure/progression or lanes takes the event lock first.
  - Score submission locks only the match row.
- **Bracket storage**: `brackets-manager` runs on `DrizzleBracketStorage` (`lib/repositories/bracket-storage.db.ts`), constructed per transaction with `(tx, eventId)`. Every read/update/delete is scoped to that event's bracket; throws on DB errors (rollback) instead of returning false; `position` in opponent JSON is structural and never changed by callers.
- **Transactional flows today**:
  - Score submission (`lib/services/scoring/score-submission.ts`)
  - Match completion incl. progression, grand final, and lane release/reassign (`lib/services/scoring/match-completion.ts`)
  - Start bracket (`startBracket` in `event-service`)
  - Reset match result, manual advance/remove, lane assign/release/maintenance/idle, clear placements, grand-final toggles
  - Lane add/delete (event lock → event row → match → lanes), league + owner creation, event creation with copied players, adding a player, qualification frames (the round row is locked before the max-frames check), team generation
- **Score writer**: `syncMatchScores` is the sole application score writer. Inside the caller's transaction it writes manual override totals when present, otherwise sums `frame_results` by the opponent teams; matches without either source have no `score` key. Manual final scores live in the `score_override_*` columns, frame edits are blocked until an admin clears the override, and clearing it restores frame-derived totals without changing the recorded winner.

---

## Services

- One service per domain concept
- Services expose intent-driven functions
  - Example: `createLeague`, not `insertLeagueRow`
- Services may:
  - Call multiple repositories
  - Enforce authorization rules (obtaining `pg` via `authorize*` / `authorizeEventView`)
  - Perform transactional logic
- **Verify event ownership**: Because direct Postgres bypasses RLS, services must verify that every ID they receive (match, lane, frame, player) belongs to the authorized event before writing

---

## Repositories

- One repository per table or aggregate
- Keep queries simple and predictable
- Do not leak database-specific shapes upward
- Drizzle repositories receive `Executor` as their first argument and never authorize or open transactions.
- Respect column restrictions: never return `events.access_code` or `players.email` to the UI

---

## Security

### CSRF Protection

- The proxy (`lib/supabase/proxy.ts`) automatically rejects every non-GET/HEAD/OPTIONS `/api/**` request whose `Origin` header does not match `Host` with a 403 Forbidden.
- `validateCsrfOrigin` (`lib/utils/csrf.ts`) remains available for explicit route-level checks.

### Rate Limiting

- Rate limiting (`lib/middleware/rate-limit.ts`) is backed by Postgres (`public.rate_limits` table + `rate_limit_hit` function, service-role only) and shared across serverless instances.
- Fails open if the database store is unavailable.
- `withRateLimit` and `withStrictRateLimit` are async (`await`).
- Public scoring routes (`app/api/score/**`) use `withScoringRateLimit` and call `recordAccessCodeFailure` in their catch blocks; failed access-code guesses are limited to 30/min per IP, and all scoring traffic to 500/min per IP.
- Public bracket views (`withPublicBracketRateLimit`) allow 1000/min per IP. Limits on routes used during an event are deliberately generous because a venue's spectators and scorers often share one IP.

### Access Codes

- Stored normalized (`lower(trim())`, enforced by a DB `CHECK` constraint).
- Matched with exact equality (never `ilike`).
- Minimum length of 6 characters for new events (`lib/utils/access-code.ts`).

---

## Database & Migrations

- Schema changes are **additive migrations** (new timestamped files in `supabase/migrations/`, starting with `202610070000000_security_lockdown.sql`). Do not edit existing `init_*` migration files.
- `lib/db/schema.ts`: GENERATED by `npm run db:pull` (`drizzle-kit pull`, `casing: preserve`) from the local Supabase database. Never hand-edit. Supabase SQL migrations stay the source of truth.
  - Workflow: write an additive migration → apply locally (`supabase migration up` or `supabase db reset`) → `npm run db:pull` → commit `schema.ts`.
  - CI runs `npm run db:check`, which fails if `schema.ts` drifted.
  - The output is normalized (tables, constraints and imports sorted; RLS policies omitted, since migrations own them and pgTAP tests them) so it doesn't depend on a database's history.
  - Known quirk: numeric columns with a `NULL` default are generated as `.default('NULL')`; pass those columns explicitly (e.g. `null`) when inserting `events` through Drizzle.
- Database role `app_server`: Migration `supabase/migrations/202610080000000_app_server_role.sql` creates role `app_server` (`LOGIN`, `BYPASSRLS`, DML on public tables, sequence usage) WITHOUT a password. Since `202610120000000_retire_rpc_functions.sql` it can execute no public functions; the only functions left are the three RLS helper predicates (`is_league_admin`, `is_league_admin_for_event`, `is_tournament_admin`). Business logic lives in the services, not plpgsql.
  - Production: set password out-of-band (`ALTER ROLE app_server WITH PASSWORD '…'`), never in git.
  - Local development: `supabase/seed.sql` sets throwaway password `app_server`.
  - Rollback script: `supabase/rollbacks/202610080000000_app_server_role.down.sql`.
- Emergency rollback scripts live in `supabase/rollbacks/` (not read or executed by the Supabase CLI).
- Default privileges: Any new table or function starts with NO client privileges (default privileges revoked). New `SECURITY DEFINER` functions must not be granted to `anon` or `authenticated` unless they are RLS helper predicates; grant privileges explicitly.
- Keep schema compatible with existing code where possible
- Prefer explicit constraints over application checks
- Database security tests (pgTAP) live in `supabase/tests/` and run with `supabase test db`.
- Integration tests in `integration/`: Run with `npm run test:int` against the local Supabase stack (`supabase start`). `*.db.int.test.ts` run services against real Postgres as `app_server` (`TEST_DATABASE_URL` overrides; global setup sets local `app_server` password). Most tests run inside a rolled-back transaction (`withRollback` in `integration/db/harness.ts`); concurrency tests commit seeded events (`integration/db/seed.ts`: `seedEvent`, `seedBracket`, `cleanupLeague`) and clean up after themselves. Flows ported to transactions are tested here, not with mocked Supabase chains.
- Local and CI Postgres must use image version `17.6.1.063` (production version). Image `17.6.1.106` has a supautils bug that segfaults the server whenever a role calls a function it lacks `EXECUTE` on. Pin it with `mkdir -p supabase/.temp && echo 17.6.1.063 > supabase/.temp/postgres-version` before `supabase start`.

---

## TypeScript Standards

- Strict mode assumed
- No `any`
- Export types for service and repo boundaries
- Narrow types as data flows upward

---

## Common Pitfalls

- ❌ Business logic in API routes
- ❌ Queries in services, or Supabase data queries anywhere (Supabase is Auth + Realtime only)
- ❌ Opening a transaction in a repository
- ❌ Taking locks out of order (event → event row → match → lane)
- ❌ Hand-editing `lib/db/schema.ts`
- ❌ Client components performing mutations directly
- ❌ Leaking database rows or sensitive columns (`events.access_code`, `players.email`) to the UI
- ❌ Writing to the database without verifying entity IDs belong to the authorized event
- ❌ Importing `lib/db/client.ts` outside the authorized locations enforced by ESLint
- ❌ A service read without an `authorize*` / `authorizeEventView` / visibility check (RLS doesn't protect server reads)
- ❌ Editing old `init_*` migration files instead of adding timestamped migrations

---

## Design Goal

The system should be:
- Easy to reason about
- Testable without HTTP
- Safe by default
- Boring in the best way
