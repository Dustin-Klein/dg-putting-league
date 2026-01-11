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
- Supabase service role keys → server-only
- Fail fast if required env vars are missing

---

## Supabase Usage

### Clients

- Use **anon client** for user-authenticated actions
- Use **service role client** only on the server
- Create Supabase clients in a shared util (not inline)

### Auth

- API routes must validate the session/user
- Never trust client-provided user IDs
- Derive user identity from Supabase auth context

### Database Access

- All Supabase queries live in `/lib/repo`
- Repositories receive explicit IDs and parameters
- Do not pass Supabase client through API layers unnecessarily

---

## Services

- One service per domain concept
- Services expose intent-driven functions
  - Example: `createLeague`, not `insertLeagueRow`
- Services may:
  - Call multiple repositories
  - Enforce authorization rules
  - Perform transactional logic

---

## Repositories

- One repository per table or aggregate
- Keep queries simple and predictable
- Do not leak database-specific shapes upward

---

## Database & Migrations

- Modify the **initial migration file** when schema changes are needed
- Keep schema compatible with existing code where possible
- Prefer explicit constraints over application checks

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
- ❌ Leaking database rows to the UI

---

## Design Goal

The system should be:
- Easy to reason about
- Testable without HTTP
- Safe by default
- Boring in the best way

