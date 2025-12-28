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
  - PFA (Per Frame Average) from the last 6 months
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
   ```

4. Run database migrations:
   ```bash
   npx supabase db reset
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

MIT
