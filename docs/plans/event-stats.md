# Event stats: plan

Status: revised after a Codex deep review; all open questions decided · 2026-11-22. The review is in `codex-critique.md`; what changed is summarized at the end.

## Designs

Mockups: **[Event Stats Designs](https://claude.ai/artifact/Tx37mR9LBfdq7irMD6DEum)** (design canvas in the app's dark scoreboard style, with sample data). The boards:

- [Public report · completed event](https://claude.ai/artifact/Tx37mR9LBfdq7irMD6DEum#artboard-Main): header, stat tiles, final standings, sortable player table, zones and putts mix, margin histogram and match facts.
- [Public report · live during bracket](https://claude.ai/artifact/Tx37mR9LBfdq7irMD6DEum#artboard-PublicLive): "In progress · N of M" badge, seed + W–L + status standings, small-sample rows dimmed.
- [Public report · phone, live](https://claude.ai/artifact/Tx37mR9LBfdq7irMD6DEum#artboard-PublicMobile): the live report at phone width (player cards instead of the wide table).
- [Admin · Stats tab](https://claude.ai/artifact/Tx37mR9LBfdq7irMD6DEum#artboard-AdminStats): data warnings, entry flags, admin player table, window-labeled handicap evaluations, qualification, CSV export, the phase 3 placeholder.
- [Edge states & components](https://claude.ai/artifact/Tx37mR9LBfdq7irMD6DEum#artboard-States): imported (points-only) events, small sample, evaluations pending, singles second chance, season context (phase 2), zone split by actual distance, entry points, linked-event visibility, dataset labels.

## Goal

Give every event a stats report built from its frames: what the field putted, how each player and team did, how close the matches were, and, in handicap events, how each zone played. There are two versions:

- a **public** report anyone can open from the league page or the bracket, and
- an **admin** report, a superset with the numbers organizers use to run the league.

Both report facts only: no verdicts, no recommendations, no generated prose. The headline numbers are **make %** and **points per match**, shown side by side everywhere a player, team or zone appears.

## Three datasets, kept apart

The report draws on three sources that mean different things. Every number states which one it comes from.

| Dataset | Source | Used for |
|---|---|---|
| **Official results** | Canonical match scores (`syncMatchScores` output: paired override if present, else frame sums), `event_placements` after completion | W–L, margins, close matches, overtime matches, standings, placement |
| **Frame performance** | `frame_results` rows | Make %, PPF, points per match, putts-made mix, 3-for-3, best match |
| **Handicap evaluation** | `player_zone_evaluations.stats` | Admin only. This is the player's *cumulative zone-period window* (possibly several events and qualification), **not** this event's performance. |

**Consequences:**
- A manual-only override has no attributable player performance. Its match counts in W–L and margins but contributes nothing to player stats.
- A match whose override disagrees with its frames shows the official score in results. Its frames still count toward player stats, and the admin view flags it.

## Starting point: the week-1/week-2 handicap reports

| Report section | Decision | Why |
|---|---|---|
| Header (players, new players, teams, matches, zones) | **Keep, both** | Plain facts. |
| Second-chance callout | **Change** → a link to the child's stats, shown only when the child itself is publicly visible | Linked events get their own report. A completed parent's child can still be private (`created`). |
| Verdict tiles | **Remove** → neutral stat tiles | These were judgments. |
| Recommendations | **Remove** | AI insight. |
| Zone moves since last week | **Admin only**, as "handicap evaluations after this event", clearly labeled as the evaluation window | League-wide zone history belongs on league/handicap pages; pending demotion flags are never shown to players (Design.md). |
| Spread by week, skill thirds, "what 5 ft is worth", counterfactuals | **Remove** | Analysis, not stats. The definitions depend on baseline choices. Candidates for a later league-level handicap page. |
| Scatter (season vs. this event) | **Admin only, phase 3**, once its baseline is defined (below) | Useful for tuning, easy to misread. |
| Per-zone make %, points per match, putts mix | **Keep, both**; grouped by zone *and* actual distance | Overridden distances must not be labeled as the zone's distance. |
| Margin distribution | **Keep, both** | This event only. |
| Team spread, rank correlation | **Admin only, phase 3**, after their definitions are fixed | See "Admin analytics: definitions required". |
| Standings | **Keep, both**: seed + W–L live, placement after completion | `event_placements` is written only at completion. |
| Player table | **Split**: public stats columns; admin adds entry flags and evaluation | My "27 ft level / suggested zone" heuristic is removed. |

**Added:**
- player and team tables with both measures;
- match facts;
- season context;
- linked-event pages;
- admin data warnings;
- CSV export.

## Metric vocabulary

Built first, in one pure module (`lib/services/event-stats/metrics.ts`) with unit tests. Every function works from **raw counts**; nothing is rounded before display, so player, team, zone and field totals reconcile.

- **Played match**: one canonical predicate, used by every match-based number.
  - Requires two real participants (not a BYE).
  - Excludes the unused archived grand-final reset. This mirrors `isByeMatch` in `lib/services/lane/lane-service.ts`; move it to a shared helper rather than copying it.
  - The match is either completed or (live) in progress with at least one frame.
  - "N of M matches complete" counts only played matches.
- **Frame**: one `frame_results` row (3 putts). Overtime frames count, as in `lib/services/handicap/stats.ts`. Sudden death can contain only some team members, so a match is not assumed to have one row per member per frame.
- **Make %** = Σ putts made ÷ (3 × Σ frames), always from summed counts and never an average of percentages. The bonus point is never included.
- **PPF** = Σ points ÷ Σ frames.
- **Normalized points** `normalizedPoints(points, frames, targetFrames) = points ÷ frames × targetFrames`. This is the shared primitive.
  - **Player points per match** = normalizedPoints with `targetFrames` = **this event's** `bracket_frame_count` (decided: PPF × frames per match).
  - `combineSeedHistory` in `stats.ts` stays five-frame-normalized until it is deliberately migrated; this plan doesn't change it.
- **Team points per match** = Σ over members of each member's normalized points. For doubles that's the pair's combined output. A member with zero frames contributes 0 and is flagged in the admin view.
  - **Team make %** = summed made ÷ summed attempts.
  - For `team_size = 1` (second chance) the team columns are omitted, since they equal the player columns.
- **Best match** (player): the highest **regulation-frame** points in one played match, from frames only (never from an override). It needs a full set of regulation frames. Tiebreak: higher make % in that match, then earlier match.
- **Highest-scoring match**: the highest combined canonical regulation score, labeled as such. Overtime is listed separately.
- **Close match**: canonical margin ≤ 2.
- **Small sample**: fewer than 10 frames. The row is dimmed, the frame count is shown, and it's excluded from "best" callouts.

### Season context (phase 2)

The same player's results in **all earlier completed events of the same league**, i.e. league to date, with no N window.
- Earlier means ordered by `(event_date, created_at, id)`, as `stats.ts` orders same-night events. A second chance therefore sees its own parent.
- Distance rules:
  - **Non-handicap events**: frames at the same actual `putt_distance_ft`.
  - **Handicap events**: frames in the same zone. Entries whose actual distance differs from the zone's nominal distance by more than the 2 ft ladder warning are excluded, and the label says "Zone 2 (27 ft)".
- Built from summed counts and normalized with this event's frame count.
- Shows "—" below 10 frames.
- Make % baselines skip events without reliable putt counts; points baselines keep them.
- Public season context uses completed public events only, mirroring `visibility.ts` in SQL.

## Public report

Route: `/event/[eventId]/stats`. It's linked from the league page's event list and the bracket page toolbar, and is visible when the bracket is (`bracket` or `completed`). During `bracket` it's labeled "In progress · N of M matches complete" (decided: live is public).

1. **Header**: date, location, players, teams, matches, bonus on/off, distance or zones (with distances and player counts).
   - It links to the bracket.
   - It links to a linked event only if *that* event is publicly visible.
2. **Stat tiles**: field make %, field points per match, matches decided by ≤ 2, overtime matches. Season averages are added in phase 2.
3. **Standings**:
   - live: seed, W–L and status ("still in", "out");
   - after completion: placement, W–L, team make %, team points per match.
4. **Players**: name, zone and actual distance, make %, points per match, frames, matches, 3-for-3 frames, best match.
   - Default sort is zone, then name (decided). Re-sorting is allowed. There are no "bottom" callouts; any "best" callout is per zone.
5. **Zones and putts mix**: per (zone, distance) group in handicap events; one field-wide group otherwise.
6. **Matches**: margin distribution, closest match, highest-scoring match, overtime matches.
7. **Qualification**: **not public after qualification closes.**
   - Today qualification rows are public only during `pre-bracket` (`isQualificationPubliclyVisible`, RLS in `202601110900000_init_qualification.sql`).
   - Decided: it stays admin only. Making it public would be its own reviewed change (`visibility.ts`, RLS, docs, tests).
   - Qualification never feeds the bracket headlines.

## Admin report

A **Stats** tab on `/admin/event/[eventId]` from `bracket` onward. It has everything public, plus:

- **Qualification block**: per-player qualification frames, make %, points (admin-visible today).
- **Handicap evaluations** (after completion only; before that the tab says "Evaluated when the event completes"):
  - each player's decision, eligibility and skip reason;
  - the window's make % and putts, labeled **"evaluation window (may include earlier events)"**, never as this event's performance.
- **Entry flags**:
  - "don't count" entries and their notes;
  - distance overrides;
  - entries whose actual distance doesn't match their zone's event distance (this catches the Nov 18 second chance).
- **Data warnings**:
  - no reliable putt counts;
  - override conflicting with frames;
  - manual-only overrides;
  - players or team members with zero frames.
- **Phase 3 analytics** (player and team spread, strength vs. finish, scatter), only once the definitions below are fixed.
- **CSV export** of the player and team tables. Cells beginning with `=`, `+`, `-` or `@` are neutralized; commas, quotes and newlines are quoted. Tested.

### Admin analytics: definitions required before phase 3

- **Pre-event team strength**: sum of members' season-context PPF (league to date).
  - Teams with a member who has no history are excluded and counted.
  - Not seed, which depends on pool rules.
- **Strength vs. finish**: Spearman rank correlation with average ranks for ties, after completion only.
- **Spread**: SD of player PPF (≥ 10 frames) and of team normalized points.
  - The league comparison is the min–max of the same statistic across earlier completed events of that league, and only same-type events (handicap with handicap).
  - Excluded ("don't count") entries are included, since spread describes the night, not the handicap decision. The view says so.

## Public vs. admin: differences and their implications

1. **Low scores in public.**
   - The public default sort is zone then name, with positive callouts only, and every row stays sortable (the data is derivable from public match scores anyway).
   - Implication: we don't claim privacy; we just don't rank the bottom by default.
2. **Zone fairness.** Make % from different distances isn't comparable, so the actual distance is shown on every row and callouts are per zone.
3. **Handicap tuning numbers** are admin only, so they can't start fairness debates without context.
4. **Flags and notes** (demotion flags, dismissal notes, `handicap_note`, the "don't count" reason, override reasons) are admin only. The public report shows nothing about evaluations.
5. **Qualification after it closes** stays admin only (decided).
6. **Live vs. final.**
   - Public during `bracket`: no placement until completion, and no callouts below 10 frames.
   - Stats are recomputed from frames (resets and rescoring show up immediately), but behind a short shared cache (below).
7. **Linked events.** A child's existence is hidden until the child is publicly visible. Admins see pending children.

## Where the boundary lives

- **Service** `lib/services/event-stats/event-stats-service.ts`:
  - `getPublicEventStats(eventId)`: `authorizeEventView(eventId, 'bracket')`, then builds the public DTO through an **allowlisting mapper** (`toPublicEventStats`). Types are erased at runtime, so the mapper, not `extends`, is the boundary.
  - Linked-event lookups apply the child's own visibility.
  - `getAdminEventStats(eventId)`: `authorizeEventAdmin`, admin DTO.
  - Admin responses are sent `Cache-Control: private, no-store`.
- **One consistent snapshot per request.** The service opens a `READ ONLY, REPEATABLE READ` transaction (services own transactions) and runs the event-local aggregates inside it, so player, team, field and match numbers can't disagree mid-score. The repository returns raw counts; DTOs are derived from them.
- **Repository** `lib/repositories/event-stats-repository.db.ts`:
  - event-local aggregate queries over this event's frames, played matches, canonical scores, entries and teams;
  - season context in a separate query (phase 2);
  - admin projections (evaluations, flags, notes) in separate functions that the public path never calls.
- **API and caching.**
  - `GET /api/public/event/[eventId]/stats`, rate-limited like the other public routes. It's the only endpoint the live page polls (about every 30 s). The page's first render may call the service directly; refreshes go through the rate-limited route.
  - Public event-local results are held in a short shared cache: about 10 s, keyed by event, with requests coalesced. Season context is cached longer (it changes only when an event completes).
  - `GET /api/event/[eventId]/stats` for admins, uncached.
  - Check the cost with `EXPLAIN (ANALYZE, BUFFERS)` against a realistic copy of prod, not only the round-trip-count query-budget test. The default pool is 3 connections, and spectators × refresh × queries is the real load.
- **Charts**: small hand-written SVG React components (bars, stacked bar, margin histogram, scatter) following the dataviz rules from the HTML reports. There's no chart library in the project.

## Data prerequisites

1. **Events without reliable putt counts.** Last season's Dec – early Feb events were imported with points only. Detecting them in data is reliable today:
   - all 7 imported events contain 3-for-3 frames scored 3 points with the bonus on, which app scoring can't produce;
   - `bonus_point_enabled` can't change after an event is created, so there's no false-positive path in the app;
   - every app-scored event has none.

   **Decided: (b).** The options considered were:
   - **(a) Logical rule in the stats repository.** No migration. It must scan each event's frames whenever reliability is needed: cheap for one event, but repeated for every past event in season-context queries. It wouldn't recognize a future bonus-off import.
   - **(b) Stored provenance column** (Codex's recommendation): `events.putt_counts_reliable boolean not null default true`, in an additive migration that backfills `false` using the rule above, once. It's free to query, and any future import sets it explicitly.
   - **My recommendation is (b).** It is the same logic run once, and it keeps the scan out of every season-context query.

   For either option, an unreliable event shows "—" for make %, the putts mix and 3-for-3, with the note "Imported scores: points only".
2. **Nov 18 second chance.** Three entries are stored at 22 and 32 ft although everyone putted from 27 ft. The child inherits the parent's handicap and zone distances at creation, and entry snapshots can't change once frames exist.
   - Phase 4 needs both a **historical correction** (one-off, reviewed, with a regression test) and a **single-distance option** for future second chances.
   - Until it's corrected, the admin report flags those entries.
   - A prod data fix needs your explicit go-ahead.
3. **Subs.** Stats are attributed to the **event entry**, not the physical thrower. Nov 18's Jason Summers frames sit wherever his entry was recorded. Admins must enter subs as themselves. The report footer states "stats follow the event entry" so nobody reads it as more than it is.

## Phases

1. **Foundation + public event-local report.**
   - Metric vocabulary and its tests, the shared played-match predicate, the repository snapshot, both service functions with the allowlisting mapper.
   - The public page: header, tiles, live/final standings, player table, zones, matches.
   - Links from the league and bracket pages.
   - The reliable-putt-counts prerequisite (whichever option is chosen).
2. **Season context and charts.** Season baselines (cached), the putts mix chart, the margin histogram, match facts.
3. **Admin tab.** Qualification block, handicap evaluations (window-labeled), entry flags, data warnings, CSV export, then the analytics with the definitions above.
4. **Data corrections.** Nov 18 second-chance distances (with approval), and the single-distance option for second chances.

Tests per phase, beyond unit and authorization tests:
- team sizes 1, 2 and 3;
- partial sudden-death frames;
- BYEs and the unused archived reset;
- manual-only and conflicting overrides;
- live events with incomplete matches;
- same-day parent/child ordering;
- hidden `created` child events;
- qualification not public after it closes;
- distance overrides;
- non-handicap events with mixed historical distances;
- imported bonus-on events (and a bonus-off fixture if option (b));
- zero-frame players and members;
- reset or rescored frames;
- cross-query consistency under concurrent scoring;
- a public response-shape test asserting admin keys are absent;
- CSV injection;
- visual baselines for the new pages.

## Out of scope

- League-level and season trend pages.
- Player-page changes beyond linking to event stats.
- Stored stat tables.

## Open questions

1. ~~Qualification after it closes~~: admin only (decided).
2. ~~Reliable putt counts~~: stored column backfilled by the rule (decided).
3. ~~Public player table default sort~~: zone, then name (decided). The admin table defaults to make % within each zone.

Decided 2026-11-22:
- points per match = PPF × frames per match;
- live stats are public during `bracket`;
- qualification stays admin only after it closes;
- public player table sorts by zone, then name; the admin table defaults to make % within each zone;
- putt-count reliability is a stored column, `events.putt_counts_reliable`, backfilled by the bonus-signature rule in an additive migration.

## Codex review: what changed

**Adopted:**
- The qualification visibility boundary: it's no longer in the public report after it closes.
- Child-event links respect the child's own visibility.
- Generic team metric (sum of members' normalized points); singles drop the team columns.
- One played-match predicate (BYEs, unused reset).
- Live standings use seed + W–L, with placement only after completion.
- Evaluation stats are labeled as the window, not this event.
- A short shared cache, polling through the rate-limited route, and an EXPLAIN check.
- A repeatable-read snapshot per request.
- A concrete season baseline: league to date, same-night ordering, same distance or zone, normalized with this event's frame count.
- Separate rules for official results vs. frame performance, so overrides are never attributed to players.
- Best match by regulation frames.
- Grouping by (zone, actual distance).
- An explicit historical fix for Nov 18 and the sub caveat.
- An allowlisting DTO mapper, a response-shape test, and admin `no-store`.
- Admin analytics definitions, CSV injection handling, and the expanded test list.

- Stored provenance for imported events (adopted after review; chosen for query cost rather than detection risk, since bonus can't change after event creation).

**Not adopted as stated:**
- Codex suggested a 5–15 s cache; I went with about 10 s and 30 s polling, which is within its range.
