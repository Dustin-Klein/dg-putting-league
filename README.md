# DG Putting League

A web application for managing disc golf putting leagues, tracking scores, and running double-elimination bracket tournaments.

## Features

### For Players

- **Score Tracking** - Keep score during league events with an easy-to-use interface
- **Event Access** - Join events using access codes provided by league administrators
- **Live Brackets** - View real-time bracket updates during tournament play

### For League Administrators

- **League Management** - Create and manage multiple putting leagues
- **Event Creation** - Schedule events with customizable settings:
  - Putt distance
  - Number of lanes
  - Bonus points (enabled/disabled)
  - Qualification rounds (optional)
- **Player Management** - Add players to events, track payment status
- **Pool Assignment** - Automatic player pool assignment (A/B) based on:
  - Qualification round scores, or
  - PFA (Per Frame Average) from the last 18 months
- **Team Generation** - Automatic team pairing of Pool A and Pool B players
- **Double-Elimination Brackets** - Full bracket management with:
  - Winner's bracket
  - Loser's bracket
  - Grand finals
- **Final Results** - View complete standings after event completion

## Tech Stack

- **Framework**: [Next.js 16](https://nextjs.org) (App Router), React 19
- **Database**: PostgreSQL on [Supabase](https://supabase.com), accessed from the server with [Drizzle ORM](https://orm.drizzle.team)
- **Authentication & Realtime**: Supabase Auth and Supabase Realtime (the browser never writes to the database)
- **Styling**: [Tailwind CSS 4](https://tailwindcss.com)
- **UI Components**: [shadcn/ui](https://ui.shadcn.com)
- **Bracket Management**: [brackets-manager](https://www.npmjs.com/package/brackets-manager) (with `brackets-model` types)

## Getting Started

### Prerequisites

- Node.js 22+
- Docker and the [Supabase CLI](https://supabase.com/docs/guides/local-development) (`npx supabase`) for the local database

### Installation

1. Clone the repository:

   ```bash
   git clone <repository-url>
   cd dg-putting-league
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Set up environment variables by creating a `.env.local` file. For the local stack, the URL and
   publishable key are printed by `npx supabase start` (step 4):

   ```env
   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=[PUBLISHABLE_KEY_FROM_SUPABASE_START]
   DATABASE_URL=postgresql://app_server:app_server@127.0.0.1:54322/postgres
   ```

   `DATABASE_URL` is server-only (never prefix with `NEXT_PUBLIC_`). The server reads and writes through it after its own authorization checks; Supabase is used only for Auth and Realtime. In production, `DATABASE_URL` connects via the Supabase Supavisor transaction pooler (port 6543, role `app_server.<project-ref>`, `?sslmode=require`).

4. Run database migrations, schema generation, and tests:

   Pin the Postgres image version to `17.6.1.063` (matching production; image `17.6.1.106` has a known supautils bug) before starting the local stack:

   ```bash
   mkdir -p supabase/.temp && echo 17.6.1.063 > supabase/.temp/postgres-version
   npx supabase start
   npx supabase db reset
   ```

   `supabase/config.toml` is committed, so no other local configuration is needed. `db reset` applies
   every migration and `supabase/seed.sql` (which sets the local `app_server` password). To apply only
   new migrations without wiping data, use `npx supabase migration up --local`.

   Generate Drizzle schema from the local database (verified in CI via `npm run db:check`):

   ```bash
   npm run db:pull
   ```

   Run database security tests (pgTAP) and integration tests:

   ```bash
   npx supabase test db
   npm run test:int
   ```

5. Start the development server:

   ```bash
   npm run dev
   ```

6. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Project Structure

```
app/
├── admin/                # League admin UI (leagues, events, players, brackets, lanes)
├── api/                  # Route handlers: parse input, authenticate, call one service
│   ├── public/           #   Public reads (rate limited)
│   └── score/            #   Access-code scoring (rate limited)
├── auth/                 # Login, sign-up, password reset
├── event/[eventId]/      # Public event pages (bracket, results)
├── leagues/              # Public league pages
├── player/, players/     # Public player profiles and search
├── score/                # Access-code scoring UI (matches, qualification)
├── error.tsx             # Error boundary (global-error.tsx for the root layout)
└── page.tsx              # Home page

components/               # Shared UI components (shadcn/ui in components/ui)
lib/
├── services/             # Business logic, authorization, transactions
├── repositories/         # Drizzle queries (*.db.ts), one per table or aggregate
├── db/                   # Drizzle client, generated schema, transaction and lock helpers
├── supabase/             # Supabase Auth clients and the request proxy (CSRF, sessions)
├── errors/               # Domain errors and handleError
└── types/                # API DTOs
integration/              # Integration tests against the local database
supabase/migrations/      # Schema migrations (additive; init_* files are the frozen baseline)
supabase/rollbacks/       # Emergency rollback SQL (not run by the CLI)
supabase/tests/           # pgTAP database security tests
```

See [docs/architecture.md](docs/architecture.md) for layering, the trust model and transaction conventions.

## Checks

```bash
npm run lint
npm run type-check
npm test            # unit tests (Jest)
npm run test:int    # integration tests (needs the local Supabase stack)
npx supabase test db
npm run db:check    # lib/db/schema.ts matches the migrations
npm run build
```

## Event Workflow

1. **Created** - Event is set up but not yet open
2. **Pre-Bracket** - Players can be added, payment tracked
3. **Bracket** - Tournament play with double-elimination bracket
4. **Completed** - Final results displayed

## License

This project is source-available. Viewing is allowed, but reuse, redistribution, or deployment requires permission from the author.
