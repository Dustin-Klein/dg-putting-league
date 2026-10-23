# Disc golf putting league

Web app to be used to manage and score disc golf putting league.

## Play

1. There is an optional 5 frame qualification round
    - A frame is 3 putts where each putt is worth one point. If "bonus point" is turned on in league settings, if all three putts are made, 4 points are earned instead of 3
2. Players are split into A pool or B pool in which 
    - If qualification round is enabled, A pool is the top half or qualification scores and B pool is the lower half
    - If qualification round is not enabled, A pool is the top half of the event signups per frame average of previous events and B pool is the lower half. If there is a new player, league admin will have to manually place them in a pool.
3. Doubles are then created with 1 person from each pool.  Thier cumalitve qualification scores are then ordered to determine seeds.
4. Double elemination bracket is created and played to completion.
    - Each bracket play match is 5 frames per person. If scores are tied after 5 frames, the match continues in sudden death until a winner is determined. This can be after only half a frame, both players on a team are not guaranteed a putt in overtime.
5. There are 1 to many (Example: 4) lanes that will be active with a match going on each of them simultaneously

## League Administrator 

- The league administrator will have to create an account and login.
- They will be able to create a "League" which will be the collection of zero to many "events"
    - A league will have one to many admins
    - A league will have a location (city)
    - A collections of stats about the events in the league (averages per event and cumulative)
- An event is a single instance of the league night
    - An event will have:
        - A date
        - A location
        - Number of lanes
        - Distance of putt for those lanes (1 value, same across all lanes; in a handicap league each zone has its own distance, see Handicaps)
        - Zero to many players
        - Custom access code
        - Bonus point (y/n) - defaults to yes
        - Qualification round (y/n) - defaults to no
- During registration the league admin will collect payment and add "players" to the event
    - A player does not sign into the webapp, but could exist in the database.
    - If a player does not already exist, adding a new player to the league event will create their identifier and add them to the system
- Once qualification matches are scored, the admin will generate teams and the bracket. 

## Scoring

A player may go to the url */score to access the scoring tool. They will then be prompted to enter the custom access code for the event (provided by league admin at registration)
    
From there, if qualifications are still active a player may add themselves and other players (typically 3,4, or 5 total) to the scorecard and track their qualification round scores.

Once qualification is done for that event, */score url will take the player to the bracket.  From there a player will be able to click on any match that is available to score (determined by number of lanes that are open) and with the teams prepopulated they score their 5+ frame match. Once a match is finished the bracket will update with scores and the lane the match was played on will move onto the next available match.

Because each frame is scored on a person by person basis (even in the team matches), we will be able to have statistics for each player. Putting stats and winning stats.

The scoring should be live updating and have no issue with multiple matches being scored at the same time.

## Player

A player can be looked up by name or unique identifier.  

A player will have a page that shows statistics:
 - previously played league events
 - averages and performances from those events

## Handicaps

A league can opt into distance-based handicaps (Admin → league → Handicaps). Scoring does not change: 3 putts per frame, 1 point per make, +1 bonus for 3/3 when enabled. The handicap is the distance.

- **Zones.** Each league has a ladder of zones, by default Zone 1 = 21 ft, Zone 2 = 27 ft, Zone 3 = 33 ft. New players start in Zone 2. The ladder is the default every new event starts from; organizers can set an event's distances for the night (a tight venue, indoor winter nights) until the first frame is recorded. A player's record is kept against the *zone*: Zone 1 at 19 ft one week and 21 ft the next is the same evidence. Adjacent zones must be at least 3 ft apart, and an event distance more than 2 ft from the ladder gets a warning.
- **When a zone changes.** Only when an event the player played in is **completed**, or when a **league admin** changes it. Nothing during a live event moves anyone, and every change applies from the next event.
- **The rule.** Once a player has enough evidence in their current zone (default 50 putts **or** 3 completed matches; either minimum can be set to 0 to switch it off, not both), their make % in the zone decides: above 75% → move up one zone (farther); otherwise stay. By default the sample is the player's most recent 150 putts in the zone (whole events, newest first); the league can count the whole period instead. Qualification putts count by default, qualification rounds never count as matches, and a match counts only if the player recorded at least one frame in it.
- **This league never moves you closer automatically** — unless its admins turn on automatic demotion, in which case the league must tell its players. Below 50%, the player is flagged for an organizer, who either moves them one zone closer or dismisses the flag with a note. A player never sees a pending flag; if an organizer moves them, their history says "Moved to Zone 2 by an organizer" and nothing more (the note is for organizers only).
- **Not representative nights.** An organizer can mark one player's entry "don't count" (for example, putting from 15 ft with an injured shoulder). That night is left out of the zone decision but still appears in the player's career stats.
- **History.** Every zone change is kept with its date and the stats that caused it. Career stats are kept per actual distance putted and never reset.
- **Pools** stay as they are: handicaps are opt-in per league and per event, and a converged handicap league can choose the flat random draw (`random_flat`) instead.

Each lane needs a marked putting line for every zone (21, 27 and 33 ft by default); communicate this before the first handicap night.

## Bracket

The bracket will be double elimination, populated by teams comprised of two people a piece.  When creating the bracket the teams will have already been seeded. Once the backet is created, an indicator will appear above a match showing which lane the match is to take place in.  The number of lanes is determined by the value set in the league event settings by the admin.  Once an active match is finished that lane should be allocated to the next appropraite match.