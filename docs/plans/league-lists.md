# Leagues and My Leagues redesign: plan

Status: implemented · 2026-11-23

## Design

Mockups: **[Leagues & My Leagues redesign](https://claude.ai/artifact/5njojCDwTJhVMsNoYbbHka)** (design canvas with sample data). The boards:

- [Leagues · desktop](https://claude.ai/artifact/5njojCDwTJhVMsNoYbbHka#artboard-Main): dark league board with a "Live now" card, then one row per league with its night dots between the first and latest event dates.
- [My Leagues · desktop](https://claude.ai/artifact/5njojCDwTJhVMsNoYbbHka#artboard-MyLeagues): board with Create league and a "Run event" card, then one card per league: role, the current night (status track, players, unpaid, second chance with lent lanes), event counts and night dots.
- [Leagues · phone](https://claude.ai/artifact/5njojCDwTJhVMsNoYbbHka#artboard-LeaguesPhone) and [My Leagues · phone](https://claude.ai/artifact/5njojCDwTJhVMsNoYbbHka#artboard-MyLeaguesPhone): the same pages at 390 px.
- [Empty states](https://claude.ai/artifact/5njojCDwTJhVMsNoYbbHka#artboard-States): no public leagues; an organizer's first visit.

It follows the league timeline (PR for `cef9bac`): `LeagueBoard`, Barlow numerals, timeline dot states (filled = done, green = live, hollow = scheduled), green 1.5 px border on anything live, `StatusTrack`, `SecondChanceMark`.

## Terms

- **Night**: a main event plus its same-day second chances (`groupEventsIntoNights`). Its state is `live` if any of its events is in bracket play, `done` if the main event is completed, else `upcoming` (the timeline's `nightState`, moved to `lib/utils/league-nights.ts` and shared).
- **Season**: every event the viewer can see. First and latest event dates are the min and max `event_date`, scheduled events included. The dot strip shows the latest 12 nights, oldest left; the label gives the total night count.
- **Current night** (My Leagues only): the live night, else the soonest night that isn't done ("Up next"), else the latest night ("Latest"). None when the league has no events.

## Public `/leagues`

Data (`getPublicLeagues`, also served by `GET /api/public/leagues`; fields are additive):

- `leagueRepo.getAllLeagues(ex, viewerId)` keeps its visibility rules (the `eventVisibleTo` predicate; leagues with no visible event stay hidden) but returns each league's `city` and its visible events (`id`, `event_date`, `status`, `parent_event_id`, `double_grand_final`) instead of only a count. Parent ids are used only to group nights and never leave the service.
- The service adds bracket progress for live events (`bracketRepo.getBracketProgressRows`, one batched call) and returns `PublicLeagueSummary`: `id`, `name`, `city`, `event_count`, `season` (`first_event_date`, `latest_event_date`, `night_count`, `nights: NightState[]`), `status` (`live` | `qualifying` | `scheduled` | `idle`) and `live_events` (`id`, `second_chance`, `match_progress`) for the live night.
- Order: live, qualifying, scheduled, idle; then latest event date (newest first), then name.

UI (`app/leagues/page.tsx`):

- `LeagueBoard` (kicker "Disc golf putting", title "Leagues"). When any league is live, the aside lists each live league with "Main bracket 18/30 · Second chance 4/14" and a Watch link to the first live event's bracket.
- "All leagues" list. Each row: name (links to the league), city · event count, `NightStrip` (first date, dots, latest date, "N nights"), a status pill (`Bracket · 18 of 30`, `Qualifying`, `Scheduled`; none when idle), Watch → (live only) and League →. The live row gets the success border.
- Empty state from the States board.

Deviation from the mockup: the public list never shows a league with no visible events (as today), so there is no "No nights yet" row there, and an idle league shows no pill instead of "Season complete" (the app can't tell a finished season from a break between nights).

## My Leagues `/admin/leagues`

Data (`getUserAdminLeagues`):

- New `eventRepo.getEventsByLeagueIds(ex, leagueIds)`: events with participant and paid counts for many leagues in two queries. `getEventsByLeagueId` calls it.
- The service builds, per league: `eventCount`, `activeEventCount`, `season`, and `currentNight` (`kind`: `live` | `next` | `latest`; `main` and `secondChances` with status, qualification flag, participant/paid counts, lane count, entry fee, `match_progress`, `borrowed_lane_labels`). Bracket progress and borrowed lanes are fetched only for current-night events, batched across leagues.
- `getLeagueEventStats` and `lastEventDate` go away (now derived from the events).
- Order: live, then up next (soonest first), then latest (newest first), then leagues with no events; ties by name.

UI (`app/admin/leagues/components/leagues-list.tsx`):

- `LeagueBoard` (kicker "League admin", title "My Leagues", "N leagues you organize · M owned") with `CreateLeagueDialog`; the aside is a "Run event" card for the first live night (progress and unpaid count), linking to `/admin/event/{main id}`.
- Card per league: name link, role badge (owner solid, admin outline), city, Open league, delete (owner only, unchanged behavior). The current night panel reuses `StatusTrack`, `SecondChanceMark` and the timeline's money note and lent-lane chips; its label is "Live now", "Up next" or "Latest". A finished latest night with nothing scheduled gets a dashed "Schedule the next night" link to the league page; a league with no events gets "No events yet" with a Create event link to the league page (the create dialog needs the league's handicap context, which this page doesn't load). Footer: Events, Active, and the `NightStrip`.
- Empty state (no leagues): the "Start your first league" board.

## Shared pieces

- `lib/utils/league-nights.ts`: export `nightState`; add `seasonSummary(events)` and `currentNight(nights)`.
- `components/league/night-strip.tsx`: dates, dots and label; dots `aria-hidden`, dates as text.
- `components/league/money-note.tsx`: moved out of the admin events list so both pages share it.
- Dates: `MMM d`, with the year on both ends when the season spans two years.

## Tests

- Unit: `seasonSummary`, `currentNight`, `nightState` (`lib/utils/__tests__/league-nights.test.ts`); `getPublicLeagues` and `getUserAdminLeagues` ordering, status and current night (`lib/services/__tests__/league-service.test.ts`).
- Integration: `getAllLeagues` returns city and only visible events; `getEventsByLeagueIds` counts per event across leagues (`integration/*.db.int.test.ts`).
- Visual: the `leagues` screenshot changes; delete its baselines and harvest new ones from CI.
- Manual: both pages on the local dev server, desktop and phone width, with live, scheduled, finished and empty leagues.
