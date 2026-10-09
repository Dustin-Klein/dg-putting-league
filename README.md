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

- **Framework**: [Next.js 15](https://nextjs.org) (App Router)
- **Database**: [Supabase](https://supabase.com) (PostgreSQL)
- **Authentication**: Supabase Auth
- **Styling**: [Tailwind CSS](https://tailwindcss.com)
- **UI Components**: [shadcn/ui](https://ui.shadcn.com)
- **Bracket Management**: [brackets-model](https://www.npmjs.com/package/brackets-model)

## Getting Started

### Prerequisites

- Node.js 18+
- A Supabase project ([create one here](https://database.new))

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

3. Set up environment variables by creating a `.env.local` file:

   ```env
   NEXT_PUBLIC_SUPABASE_URL=[YOUR_SUPABASE_PROJECT_URL]
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=[YOUR_SUPABASE_ANON_KEY]
   SUPABASE_SECRET_KEY=[YOUR_SUPABASE_SECRET_KEY]
   DATABASE_URL=postgresql://app_server:app_server@127.0.0.1:54322/postgres
   ```

   `SUPABASE_SECRET_KEY` and `DATABASE_URL` are server-only (never prefix with `NEXT_PUBLIC_`). For local development, find the secret key under `SECRET_KEY` in `npx supabase status`. In production, `DATABASE_URL` connects via the Supabase Supavisor transaction pooler (port 6543, role `app_server.<project-ref>`, `?sslmode=require`).

4. Run database migrations, schema generation, and tests:

   Pin the Postgres image version to `17.6.1.063` (matching production; image `17.6.1.106` has a known supautils bug) before starting the local stack:

   ```bash
   mkdir -p supabase/.temp && echo 17.6.1.063 > supabase/.temp/postgres-version
   npx supabase start
   npx supabase db reset
   ```

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
├── api/                  # API routes
├── auth/                 # Authentication pages
├── event/[eventId]/      # Event pages (scoring, brackets, results)
├── league/[leagueId]/    # League management pages
├── leagues/              # User's leagues list
├── score/                # Score entry page
└── page.tsx              # Home page

components/               # Reusable UI components
lib/                      # Utility functions and database helpers
supabase/migrations/      # Database schema migrations
```

## Event Workflow

1. **Created** - Event is set up but not yet open
2. **Pre-Bracket** - Players can be added, payment tracked
3. **Bracket** - Tournament play with double-elimination bracket
4. **Completed** - Final results displayed

## License

This project is source-available. Viewing is allowed, but reuse, redistribution, or deployment requires permission from the author.
