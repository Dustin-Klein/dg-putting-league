# Architecture Guide (Next.js + Supabase)

This document explains how the project is structured and how pieces interact.

## High-Level Flow

```
HTTP Request
  → API Route
    → Service
      → Repository
        → Supabase / Database
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
- `SUPABASE_SECRET_KEY` → server-only secret key (never `NEXT_PUBLIC_`); required in production (startup fails via `instrumentation.ts` if missing)
- Supabase service role keys → server-only
- Fail fast if required env vars are missing

---

## Supabase Usage

### Trust Model & Clients

- The browser only authenticates (Supabase Auth) and subscribes to Realtime.
- Database roles `anon` and `authenticated` can only `SELECT` (governed by RLS policies). They cannot write to any table or execute business functions.
- Server reads for public pages and admin list views use the user-scoped server client (`lib/supabase/server.ts`), so RLS keeps filtering them.
- All writes and business RPCs run on the Next.js server with a privileged client created from `SUPABASE_SECRET_KEY` (`lib/supabase/privileged.ts`).
- The privileged client is type-branded as `PrivilegedClient` (`lib/supabase/types.ts`).
- Direct imports of `lib/supabase/privileged.ts` are strictly restricted to `lib/services/auth/**` (enforced by ESLint `no-restricted-imports`).
- Services obtain `PrivilegedClient` exclusively through authorization functions in `lib/services/auth/auth-service.ts`: `authorizeEventAdmin`, `authorizeLeagueAdmin`, `authorizeLeagueOwner`, `authorizeAnyLeagueAdmin`, `authorizeLeagueCreation`, `authorizeAccessCode`, or `requireEventAdmin` (which returns it as `supabase`). Each performs its check before returning the client.

### Auth

- API routes must validate the session/user
- Never trust client-provided user IDs
- Derive user identity from Supabase auth context

### Database Access

- All Supabase queries live in `/lib/repositories`
- Repositories receive explicit IDs and parameters
- Do not pass Supabase client through API layers unnecessarily
- Repository functions that write or call business RPCs take `PrivilegedClient`; read-only repository functions take the regular server client (`SupabaseClient`)
- Column restrictions: clients cannot read `events.access_code`, `players.email`, or (for anon) `event_players.payment_type`
- Never use `select('*')` on `events`; use `EVENT_COLUMNS` from `lib/repositories/event-repository.ts`. Admins access the access code via `getEventForViewer` / `getEventAccessCode` (privileged)

---

## Services

- One service per domain concept
- Services expose intent-driven functions
  - Example: `createLeague`, not `insertLeagueRow`
- Services may:
  - Call multiple repositories
  - Enforce authorization rules (obtaining `PrivilegedClient` via `authorize*`)
  - Perform transactional logic
- **Verify event ownership**: Because `PrivilegedClient` bypasses RLS, services must verify that every ID they receive (match, lane, frame, player) belongs to the authorized event before writing

---

## Repositories

- One repository per table or aggregate
- Keep queries simple and predictable
- Do not leak database-specific shapes upward
- Repository functions performing writes or business RPCs require `PrivilegedClient`; read-only queries take the standard server client
- Respect column restrictions: never `select('*')` on `events` (use `EVENT_COLUMNS`) or expose `players.email`

---

## Security

### CSRF Protection

- The proxy (`lib/supabase/proxy.ts`) automatically rejects every non-GET/HEAD/OPTIONS `/api/**` request whose `Origin` header does not match `Host` with a 403 Forbidden.
- `validateCsrfOrigin` (`lib/utils/csrf.ts`) remains available for explicit route-level checks.

### Rate Limiting

- Rate limiting (`lib/middleware/rate-limit.ts`) is backed by Postgres (`public.rate_limits` table + `rate_limit_hit` function, service-role only) and shared across serverless instances.
- Fails open if the database store is unavailable.
- `withRateLimit` and `withStrictRateLimit` are async (`await`).
- Public scoring routes (`app/api/score/**`) use `withScoringRateLimit` and call `recordAccessCodeFailure` in their catch blocks; failed access-code guesses are limited to 10/min per IP.

### Access Codes

- Stored normalized (`lower(trim())`, enforced by a DB `CHECK` constraint).
- Matched with exact equality (never `ilike`).
- Minimum length of 6 characters for new events (`lib/utils/access-code.ts`).

---

## Database & Migrations

- Schema changes are **additive migrations** (new timestamped files in `supabase/migrations/`, starting with `202610070000000_security_lockdown.sql`). Do not edit existing `init_*` migration files.
- Emergency rollback scripts live in `supabase/rollbacks/` (not read or executed by the Supabase CLI).
- Default privileges: Any new table or function starts with NO client privileges (default privileges revoked). New `SECURITY DEFINER` functions must not be granted to `anon` or `authenticated` unless they are RLS helper predicates; grant privileges explicitly.
- Keep schema compatible with existing code where possible
- Prefer explicit constraints over application checks
- Database security tests (pgTAP) live in `supabase/tests/` and run with `supabase test db`.
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
- ❌ Supabase queries in services
- ❌ Client components performing mutations directly
- ❌ Leaking database rows or sensitive columns (`events.access_code`, `players.email`) to the UI
- ❌ Writing to the database without verifying entity IDs belong to the authorized event
- ❌ Importing `lib/supabase/privileged.ts` outside `lib/services/auth/**`
- ❌ Typing write repository functions with the non-privileged client
- ❌ Using `select('*')` on `events` instead of `EVENT_COLUMNS`
- ❌ Editing old `init_*` migration files instead of adding timestamped migrations

---

## Design Goal

The system should be:
- Easy to reason about
- Testable without HTTP
- Safe by default
- Boring in the best way

