# Agent Instructions

## Project context

DG Putting League is a Next.js (App Router) + Supabase (Postgres, Auth) app for
running disc golf putting leagues: events, qualification rounds, pool/team
assignment, live scoring, and double-elimination brackets (`brackets-manager`).

- Layering is strict and flows downward only: `app/api/*/route.ts` → `lib/services/*`
  → `lib/repositories/*` → Supabase. See `docs/architecture.md`.
- Routes parse input (zod), authenticate, call one service entry point, and return
  errors via `handleError` (`lib/errors`). Business logic does not belong in routes;
  Supabase queries do not belong in services.
- Trust model: browser/client roles (`anon`, `authenticated`) can only SELECT via RLS.
  All writes and business RPCs require a type-branded `PrivilegedClient` (`lib/supabase/types.ts`)
  or Drizzle `Db` (`lib/db/tx.ts`) obtained via authorization functions in `lib/services/auth/auth-service.ts`
  (`authorize*`) or `requireEventAdmin`. Because privileged clients bypass RLS, services must verify that
  all entity IDs belong to the authorized event before writing.
- Drizzle layer: server writes for transactional flows use Drizzle ORM (`lib/db/`, direct Postgres
  connection as role `app_server`). Authorization functions return `{ db, pg }` (`pg` is `Db`).
- Services own transactions (`withTransaction`); repositories never open transactions. Repositories
  using Drizzle use `.db.ts` suffix and take `ex: Executor` (`Db | Tx`) as their first parameter.
- Lock order (prevents deadlocks): event advisory lock (`lockEvent`) → match rows (`lockMatch`,
  ascending id) → lane rows (ascending id). Mutating bracket structure/progression or lanes takes the
  event lock first; score submission locks only the match row.
- CSRF protection is enforced centrally in `lib/supabase/proxy.ts` (rejects non-GET/HEAD/OPTIONS
  `/api/**` requests where Origin does not match Host). `validateCsrfOrigin` (`lib/utils/csrf.ts`)
  remains available for explicit checks. Many routes use `lib/middleware/rate-limit.ts`.
- Authorization is enforced in two places: service-layer checks and Postgres RLS
  policies / `SECURITY DEFINER` functions in `supabase/migrations/`.
- Schema changes are additive migrations (new timestamped files in `supabase/migrations/`,
  starting with `202610070000000_security_lockdown.sql`). Do not edit existing `init_*`
  migration files (flag any edits to them). Emergency rollback SQL lives in `supabase/rollbacks/`.
- Checks: `npm run lint`, `npm run type-check`, `npm test` (Jest), `npm run test:int` (integration tests, needs `supabase start`), `npm run db:check`, `npm run build`.

# Code Review Instructions

## Review priorities

Prioritize findings that could cause:

- Incorrect behavior or regressions
- Production outages or operational issues
- Security vulnerabilities
- Data corruption or inconsistent state
- Concurrency or race-condition bugs
- Resource leaks
- Incorrect error handling
- Breaking API or contract changes
- Performance regressions in meaningful code paths
- Missing tests for important behavior changes

## Review style

- Only leave comments for issues that are actionable and worth fixing.
- Prefer a small number of high-confidence findings over many speculative findings.
- Do not comment on formatting, whitespace, import ordering, or other issues handled
  by ESLint/TypeScript.
- Do not leave subjective style comments unless the code is materially harder to
  understand or maintain.
- Do not suggest refactors unrelated to the PR's purpose.
- Do not ask for additional abstractions unless they solve a concrete problem.
- Avoid duplicate comments about the same underlying issue.
- For dependency-bump PRs (Dependabot), focus on breaking changes that affect how
  this repo uses the package; do not summarize the changelog.

## Correctness

When reviewing a change:

- Compare the implementation against the intent described by the PR.
- Consider edge cases, failure paths, null/empty inputs, and partial failures.
- Check whether existing behavior could unintentionally change.
- Look for assumptions that are not enforced by the code.
- Check callers and downstream consumers when a contract changes — including
  client components that call API routes and the TypeScript types in `lib/types`.

Domain areas that deserve extra scrutiny:

- **Scoring**: frame results, bonus points, match score sync triggers, and
  qualification totals. Off-by-one or double-counting errors directly change
  standings.
- **Brackets**: match progression, winner/loser bracket advancement, grand finals,
  and the bracket transition/rollback functions. An incorrect state transition can
  strand an event mid-tournament.
- **Lanes**: assignment/release/maintenance must not leave two active matches on
  one lane or a lane stuck as occupied.
- **Pools and teams**: Pool A/B assignment from qualification scores or PFA, and
  team pairing.
- **Transactions and locking**: writes in ported flows must happen inside the service's
  transaction, under the documented lock order (event → match → lane).

## Error handling

Flag cases where:

- Errors are swallowed or converted into misleading success responses.
- Supabase `{ error }` results are ignored, so a failed query is treated as empty
  data or success.
- Exceptions lose useful context, or internal error details leak to clients instead
  of going through `handleError`.
- Partial work can leave the system in an inconsistent state (e.g. multiple
  sequential writes from a service that should be a single RPC/transaction).
- Retries could duplicate non-idempotent operations (e.g. re-submitted scores).
- Resources may not be released on failure.

## Concurrency

Multiple scorers can submit results for the same event, match, or lane at the same
time. Flag read-modify-write sequences in application code that should be atomic in
the database, and changes that weaken existing atomic RPCs or row locking.

## Tests

Request tests when the PR introduces or changes meaningful behavior and:

- The changed behavior is not already covered.
- Important edge cases are missing.
- A bug fix does not include a regression test when practical.

Tests live in `__tests__` directories next to the code (Jest via `next/jest`).
Do not request tests solely to increase coverage percentage.

## Security

Pay particular attention to:

- Authentication and authorization boundaries: API routes must derive the user
  from Supabase auth, never from client-provided user IDs, and admin-only
  operations must verify league/event admin rights.
- Privileged client rules: flag any import of the privileged client (`lib/supabase/privileged.ts`)
  outside `lib/services/auth/**`, and flag any write or business RPC repository function
  typed with the non-privileged client instead of `PrivilegedClient`.
- RLS policies and `SECURITY DEFINER` functions: check that policies are not
  loosened unintentionally, that definer functions set `search_path` and perform
  their own authorization checks, and that `GRANT EXECUTE` is not broader than
  needed. Flag any new GRANT to `anon` or `authenticated`.
- Public access-code scoring endpoints (`app/api/score`, `app/api/public`): access
  codes must only grant access to their own event. New public routes should use
  the rate limiter like the existing ones in `app/api/public`.
- CSRF protection: proxy covers `/api/**` automatically; flag state-changing
  routes that bypass `/api`.
- Service-role keys or other secrets reaching client code or `NEXT_PUBLIC_*` vars.
- Input validation (zod schemas on route inputs), injection, sensitive data
  exposure (e.g. returning player emails or full DB rows to the UI), path
  traversal, and privilege escalation. Flag any `select('*')` on `events` (use
  `EVENT_COLUMNS`) or `players` (email must not be exposed).

## Review comments

For each finding:

- Explain the concrete failure scenario.
- Point to the relevant code.
- Explain why it matters.
- Suggest a fix when the fix is reasonably clear.
- Avoid vague comments such as "this could be cleaner" or "consider refactoring."

If you cannot identify a realistic failure mode or meaningful maintenance risk,
do not leave a comment.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
