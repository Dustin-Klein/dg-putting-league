/**
 * Test Utilities and Mock Factories
 *
 * Provides reusable test data factories, mock utilities, and helpers
 * for testing the services layer.
 */

import type { User } from '@supabase/supabase-js';

// ============================================================================
// Mock Supabase Client
// ============================================================================

export interface MockSupabaseQuery {
  select: jest.Mock;
  insert: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
  eq: jest.Mock;
  neq: jest.Mock;
  in: jest.Mock;
  not: jest.Mock;
  ilike: jest.Mock;
  gte: jest.Mock;
  lte: jest.Mock;
  order: jest.Mock;
  limit: jest.Mock;
  single: jest.Mock;
  maybeSingle: jest.Mock;
}

export interface MockSupabaseAuth {
  getUser: jest.Mock;
}

export interface MockSupabaseClient {
  from: jest.Mock;
  auth: MockSupabaseAuth;
  rpc: jest.Mock;
}

/**
 * Create a chainable mock query builder
 */
export function createMockQueryBuilder(
  resolveWith: { data: unknown; error: unknown } = { data: null, error: null }
): MockSupabaseQuery {
  const mockQuery: MockSupabaseQuery = {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    neq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    not: jest.fn().mockReturnThis(),
    ilike: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    lte: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(resolveWith),
    maybeSingle: jest.fn().mockResolvedValue(resolveWith),
  };

  // Make all methods return the mock for chaining
  Object.keys(mockQuery).forEach((key) => {
    if (key !== 'single' && key !== 'maybeSingle') {
      ((mockQuery as unknown) as Record<string, jest.Mock>)[key].mockReturnThis();
    }
  });

  return mockQuery;
}

/**
 * Create a mock Supabase client
 */
export function createMockSupabaseClient(): MockSupabaseClient {
  const mockClient: MockSupabaseClient = {
    from: jest.fn(),
    auth: {
      getUser: jest.fn(),
    },
    rpc: jest.fn(),
  };

  return mockClient;
}

/**
 * Configure mock client to return specific data for a table
 */
export function mockTableQuery(
  mockClient: MockSupabaseClient,
  tableName: string,
  queryBuilder: MockSupabaseQuery
): void {
  mockClient.from.mockImplementation((table: string) => {
    if (table === tableName) {
      return queryBuilder;
    }
    return createMockQueryBuilder();
  });
}

// ============================================================================
// Test Data Factories
// ============================================================================

/**
 * Create a mock user
 */
export function createMockUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-123',
    email: 'test@example.com',
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  } as User;
}

/**
 * Create a mock player
 */
export function createMockPlayer(overrides: Partial<MockPlayer> = {}): MockPlayer {
  return {
    id: 'player-123',
    full_name: 'John Doe',
    email: 'john@example.com',
    nickname: 'Johnny',
    player_number: 42,
    default_pool: 'A' as const,
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

export interface MockPlayer {
  id: string;
  full_name: string;
  email?: string;
  nickname?: string;
  player_number?: number;
  default_pool?: 'A' | 'B';
  created_at: string;
}

/**
 * Create a mock event player
 */
export function createMockEventPlayer(
  overrides: Partial<MockEventPlayer> = {}
): MockEventPlayer {
  const player = createMockPlayer(overrides.player);
  return {
    id: 'event-player-123',
    event_id: 'event-123',
    player_id: player.id,
    has_paid: false,
    pool: null,
    pfa_score: null,
    scoring_method: null,
    player,
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

export interface MockEventPlayer {
  id: string;
  event_id: string;
  player_id: string;
  has_paid: boolean;
  pool: 'A' | 'B' | null;
  pfa_score: number | null;
  scoring_method: 'qualification' | 'pfa' | 'default' | null;
  player: MockPlayer;
  created_at: string;
}

/**
 * Create a mock event
 */
export function createMockEvent(overrides: Partial<MockEvent> = {}): MockEvent {
  return {
    id: 'event-123',
    league_id: 'league-123',
    event_date: '2024-06-15',
    location: 'Test Location',
    status: 'created',
    lane_count: 4,
    access_code: 'ABC123',
    bonus_point_enabled: true,
    qualification_round_enabled: false,
    bracket_frame_count: 5,
    qualification_frame_count: 5,
    entry_fee_per_player: null,
    admin_fees: null,
    payout_structure: null,
    created_at: '2024-01-01T00:00:00Z',
    putt_distance_ft: 15,
    ...overrides,
  };
}

export interface MockEvent {
  id: string;
  league_id: string;
  event_date: string;
  location: string | null;
  status: 'created' | 'pre-bracket' | 'bracket' | 'completed';
  lane_count: number;
  access_code: string;
  bonus_point_enabled: boolean;
  qualification_round_enabled: boolean;
  bracket_frame_count: number;
  qualification_frame_count: number;
  entry_fee_per_player: number | null;
  admin_fees: number | null;
  payout_structure: { place: number; percentage: number }[] | null;
  created_at: string;
  putt_distance_ft: number;
  participant_count?: number;
}

/**
 * Create a mock event with players (EventWithDetails)
 */
export function createMockEventWithDetails(
  eventOverrides: Partial<MockEvent> = {},
  players: MockEventPlayer[] = []
): MockEventWithDetails {
  const baseEvent = createMockEvent(eventOverrides);
  return {
    ...baseEvent,
    players,
    participant_count: baseEvent.participant_count ?? players.length,
  };
}

export interface MockEventWithDetails extends MockEvent {
  players: MockEventPlayer[];
  participant_count: number;
}

/**
 * Create a mock league
 */
export function createMockLeague(overrides: Partial<MockLeague> = {}): MockLeague {
  return {
    id: 'league-123',
    name: 'Test League',
    city: 'Test City',
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

export interface MockLeague {
  id: string;
  name: string;
  city?: string | null;
  created_at: string;
}

/**
 * Create a mock league admin
 */
export function createMockLeagueAdmin(
  overrides: Partial<MockLeagueAdmin> = {}
): MockLeagueAdmin {
  return {
    id: 'admin-123',
    league_id: 'league-123',
    user_id: 'user-123',
    role: 'admin',
    ...overrides,
  };
}

export interface MockLeagueAdmin {
  id: string;
  league_id: string;
  user_id: string;
  role: 'owner' | 'admin';
}

/**
 * Create a mock team
 */
export function createMockTeam(overrides: Partial<MockTeam> = {}): MockTeam {
  return {
    id: 'team-123',
    event_id: 'event-123',
    seed: 1,
    pool_combo: 'Player A & Player B',
    created_at: '2024-01-01T00:00:00Z',
    team_members: [],
    ...overrides,
  };
}

export interface MockTeam {
  id: string;
  event_id: string;
  seed: number;
  pool_combo: string;
  created_at: string;
  team_members: MockTeamMember[];
}

export interface MockTeamMember {
  id: string;
  team_id: string;
  event_player_id: string;
  role: 'A_pool' | 'B_pool';
}

/**
 * Create a mock bracket match
 */
export function createMockBracketMatch(
  overrides: Partial<MockBracketMatch> = {}
): MockBracketMatch {
  return {
    id: 1,
    stage_id: 1,
    group_id: 1,
    round_id: 1,
    number: 1,
    status: 2, // Ready
    event_id: 'event-123',
    lane_id: null,
    opponent1: { id: 1, score: 0 },
    opponent2: { id: 2, score: 0 },
    ...overrides,
  };
}

export interface MockBracketMatch {
  id: number;
  stage_id: number;
  group_id: number;
  round_id: number;
  number: number;
  status: number;
  event_id: string;
  lane_id: string | null;
  opponent1: { id: number | null; score?: number } | null;
  opponent2: { id: number | null; score?: number } | null;
}

/**
 * Create a mock lane
 */
export function createMockLane(overrides: Partial<MockLane> = {}): MockLane {
  return {
    id: 'lane-123',
    event_id: 'event-123',
    label: 'Lane 1',
    status: 'idle',
    ...overrides,
  };
}

export interface MockLane {
  id: string;
  event_id: string;
  label: string;
  status: 'idle' | 'active' | 'maintenance';
}

/**
 * Create a mock qualification round
 */
export function createMockQualificationRound(
  overrides: Partial<MockQualificationRound> = {}
): MockQualificationRound {
  return {
    id: 'qual-round-123',
    event_id: 'event-123',
    frame_count: 10,
    status: 'not_started',
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

export interface MockQualificationRound {
  id: string;
  event_id: string;
  frame_count: number;
  status: 'not_started' | 'in_progress' | 'completed';
  created_at: string;
}

/**
 * Create a mock qualification frame
 */
export function createMockQualificationFrame(
  overrides: Partial<MockQualificationFrame> = {}
): MockQualificationFrame {
  return {
    id: 'qual-frame-123',
    qualification_round_id: 'qual-round-123',
    event_id: 'event-123',
    event_player_id: 'event-player-123',
    frame_number: 1,
    putts_made: 2,
    points_earned: 2,
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

export interface MockQualificationFrame {
  id: string;
  qualification_round_id: string;
  event_id: string;
  event_player_id: string;
  frame_number: number;
  putts_made: number;
  points_earned: number;
  created_at: string;
}

/**
 * Create a mock match frame
 */
export function createMockMatchFrame(
  overrides: Partial<MockMatchFrame> = {}
): MockMatchFrame {
  return {
    id: 'frame-123',
    bracket_match_id: 1,
    frame_number: 1,
    is_overtime: false,
    ...overrides,
  };
}

export interface MockMatchFrame {
  id: string;
  bracket_match_id: number;
  frame_number: number;
  is_overtime: boolean;
}

/**
 * Create a mock frame result
 */
export function createMockFrameResult(
  overrides: Partial<MockFrameResult> = {}
): MockFrameResult {
  return {
    id: 'result-123',
    match_frame_id: 'frame-123',
    event_player_id: 'event-player-123',
    putts_made: 2,
    points_earned: 2,
    order_in_frame: 1,
    ...overrides,
  };
}

export interface MockFrameResult {
  id: string;
  match_frame_id: string;
  event_player_id: string;
  putts_made: number;
  points_earned: number;
  order_in_frame: number;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create multiple mock players
 */
export function createMockPlayers(count: number): MockPlayer[] {
  return Array.from({ length: count }, (_, i) =>
    createMockPlayer({
      id: `player-${i + 1}`,
      full_name: `Player ${i + 1}`,
      email: `player${i + 1}@example.com`,
      player_number: i + 1,
      default_pool: i % 2 === 0 ? 'A' : 'B',
    })
  );
}

/**
 * Create multiple mock event players
 */
export function createMockEventPlayers(
  count: number,
  eventId: string = 'event-123'
): MockEventPlayer[] {
  const players = createMockPlayers(count);
  return players.map((player, i) =>
    createMockEventPlayer({
      id: `event-player-${i + 1}`,
      event_id: eventId,
      player_id: player.id,
      player,
      has_paid: true,
    })
  );
}

/**
 * Create teams from event players (pairs pool A with pool B)
 */
export function createMockTeamsFromPlayers(
  eventPlayers: MockEventPlayer[],
  eventId: string = 'event-123'
): MockTeam[] {
  const poolA = eventPlayers.filter((ep) => ep.pool === 'A');
  const poolB = eventPlayers.filter((ep) => ep.pool === 'B');
  const teams: MockTeam[] = [];

  const minSize = Math.min(poolA.length, poolB.length);
  for (let i = 0; i < minSize; i++) {
    teams.push(
      createMockTeam({
        id: `team-${i + 1}`,
        event_id: eventId,
        seed: i + 1,
        pool_combo: `${poolA[i].player.full_name} & ${poolB[i].player.full_name}`,
        team_members: [
          {
            id: `member-a-${i + 1}`,
            team_id: `team-${i + 1}`,
            event_player_id: poolA[i].id,
            role: 'A_pool',
          },
          {
            id: `member-b-${i + 1}`,
            team_id: `team-${i + 1}`,
            event_player_id: poolB[i].id,
            role: 'B_pool',
          },
        ],
      })
    );
  }

  return teams;
}

/**
 * Wait for all pending promises to resolve
 */
export function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
