# Disc golf putting league

Web app to be used to manage and score disc golf putting league.

## Play

1. 5 frame qualification round
    - A frame is 3 putts where each putt is worth one point. If "bonus point" is turned on in league settings, if all three putts are made, 4 points are earned instead of 3
2. Players are split into A pool or B pool in which A pool is the top half or qualification scores and B pool is the lower half
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
        - Distance of putt for those lanes (1 value, same across all lanes)
        - Zero to many players
        - Custom access code
        - Bonus point (y/n) - defaults to yes
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

## Bracket

The bracket will be double elimination, populated by teams comprised of two people a piece.  When creating the bracket the teams will have already been seeded. Once the backet is created, an indicator will appear above a match showing which lane the match is to take place in.  The number of lanes is determined by the value set in the league event settings by the admin.  Once an active match is finished that lane should be allocated to the next appropraite match.