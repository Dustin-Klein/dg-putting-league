# Pool Splitting Implementation Prompt

## Overview
Create a function that automatically splits all registered players into Pool A (top half) and Pool B (bottom half) when an event's status changes from `pre-bracket` to `bracket`. The splitting logic depends on whether qualification is enabled for the event.

## Requirements

### Trigger Condition
- Execute when `event.status` changes from `'pre-bracket'` to `'bracket'`
- Only proceed after all validation checks pass (existing validation in `validateEventStatusTransition`)
- This should be integrated into the existing event status update flow

### Splitting Logic

#### If Qualification is Enabled (`qualification_round_enabled = true`)
1. **Eligibility Check**: All players must have completed their qualification rounds (already validated in `validateEventStatusTransition`)
2. **Scoring**: Calculate total qualification score for each player:
   - Query `qualification_frames` table for each `event_player_id`
   - Sum all `points_earned` values for that player
   - Use `qualification_rounds.frame_count` to ensure all frames are included
3. **Ordering**: Sort players by descending total qualification score (highest first)
4. **Split**: 
   - Top 50% of players (by score) → Pool A
   - Bottom 50% of players (by score) → Pool B
5. **Tie-breaking**: If players have identical scores:
   - Use their `default_pool` from the `players` table as fallback
   - If still tied, maintain existing order from database

#### If Qualification is Disabled (`qualification_round_enabled = false`)
1. **PFA Calculation**: Calculate Per Frame Average (PFA) for each player from the last 6 months:
   - Query `frame_results` table for the player across all events in the last 6 months
   - Filter: `frame_results.recorded_at >= NOW() - INTERVAL '6 months'`
   - PFA = Total `points_earned` / Total number of frames
   - If no frames found, use player's `default_pool` as their assigned pool
2. **Ordering**: Sort players by descending PFA (highest first)
3. **Split**:
   - Top 50% of players (by PFA) → Pool A
   - Bottom 50% of players (by PFA) → Pool B
4. **New Players**: Players with no frame history:
   - Assign to their `default_pool` from `players` table
   - If `default_pool` is null, assign to Pool B
   - These players don't count toward the 50% split calculation for established players

### Database Operations

#### Update Event Players
- Update `event_players.pool` field for all registered players
- Use transaction to ensure all updates succeed or none do
- Return updated player list with pool assignments

#### Error Handling
- Handle cases where player count is odd (top half gets the extra player)
- Validate that all players have been assigned a pool
- Rollback transaction if any errors occur

### Integration Points

#### Function Signature
```typescript
async function splitPlayersIntoPools(eventId: string): Promise<EventPlayer[]>
```

#### Call Location
- Add call in event status update flow after `validateEventStatusTransition` passes
- Only execute when transitioning from `pre-bracket` to `bracket`

#### Dependencies
- Use existing `requireEventAdmin` for authorization
- Leverage existing database connection patterns
- Follow existing error handling patterns

### Testing Requirements

#### Test Cases
1. **Even number of players with qualification enabled**
   - Verify correct pool assignment based on scores
   - Test tie-breaking scenarios

2. **Odd number of players**
   - Verify top half gets extra player

3. **Qualification disabled with mixed player history**
   - Test players with full 6-month history
   - Test new players with no history
   - Verify `default_pool` fallback

4. **Edge cases**
   - Single player event
   - All players have identical scores/PFA
   - Players with no `default_pool` set

### Performance Considerations
- Use efficient queries to avoid N+1 problems
- Consider batching updates for large events
- Add appropriate database indexes if needed

### Return Value
- Return updated array of `EventPlayer` objects with `pool` field populated
- Include any relevant metadata (split method used, etc.)
- Maintain existing player ordering where possible for consistency

## Implementation Notes

### Existing Schema References
- `events.qualification_round_enabled` - determines split method
- `event_players.pool` - field to update with 'A' or 'B'
- `players.default_pool` - fallback for new players/ties
- `qualification_frames.points_earned` - qualification scoring
- `frame_results.points_earned` - historical PFA calculation
- `frame_results.recorded_at` - for 6-month filtering

### Business Logic Alignment
- Follows design document specifications for pool splitting
- Maintains consistency with existing qualification flow
- Preserves player ranking integrity for fair bracket seeding
