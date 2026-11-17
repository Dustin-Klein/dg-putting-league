import { act, render, screen, waitFor, within } from '@testing-library/react';
import type { EventWithDetails } from '@/lib/types/event';
import type { EventPlayer } from '@/lib/types/player';
import { EventHeader } from '../event-header';

jest.mock('@/components/next-status-button', () => ({ NextStatusButton: () => <button type="button">Next status</button> }));
jest.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: jest.fn() }) }));
const realtime: { onChange?: () => void } = {};
jest.mock('@/lib/supabase/client', () => ({
  createClient: () => {
    const channel = {
      on: (_type: string, _filter: unknown, callback: () => void) => {
        realtime.onChange = callback;
        return channel;
      },
      subscribe: () => channel,
      unsubscribe: jest.fn(),
    };
    return { channel: () => channel };
  },
}));
jest.mock('../event-handicap', () => ({
  useEventHandicap: () => null,
  ZoneDistancesPopover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

function player(id: string, payment: EventPlayer['payment_type']): EventPlayer {
  return { id, payment_type: payment } as EventPlayer;
}

function event(overrides: Partial<EventWithDetails> = {}): EventWithDetails {
  return {
    id: 'event-1',
    event_date: '2026-11-17',
    location: 'Brewhouse',
    status: 'pre-bracket',
    lane_count: 4,
    putt_distance_ft: 15,
    access_code: 'K7QM4R',
    viewer_is_admin: true,
    bonus_point_enabled: false,
    qualification_round_enabled: false,
    bracket_frame_count: 5,
    qualification_frame_count: 5,
    bracket_format: 'double_elimination',
    double_grand_final: true,
    third_place_match: false,
    entry_fee_per_player: 10,
    admin_fees: null,
    admin_fee_per_player: null,
    payout_pool_override: null,
    payout_structure: null,
    team_size: 2,
    team_assignment: 'random_pairing',
    parent_event_id: null,
    link_type: null,
    handicap_enabled: false,
    created_at: '2026-11-01',
    players: [player('a', 'cash'), player('b', 'electronic'), player('c', null)],
    participant_count: 3,
    league_id: 'league-1',
    ...overrides,
  };
}

const stats = () => within(screen.getAllByRole('definition')[0].closest('dl')!);

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ players: [{ is_complete: true }, { is_complete: true }, { is_complete: false }] }),
  });
});

describe('EventHeader', () => {
  it('shows registration numbers and only the enabled format parts', () => {
    render(<EventHeader event={event()} />);
    expect(screen.getByText('Doubles, one from each pool · 5-frame matches · bracket reset')).toBeInTheDocument();
    expect(screen.getByLabelText('K7QM4R')).toBeInTheDocument();
    expect(stats().getByText('1 unpaid')).toBeInTheDocument();
    expect(stats().getByText('$20')).toBeInTheDocument();
    expect(stats().getByText('$10 cash · $10 electronic')).toBeInTheDocument();
    expect(stats().getByText('15 ft')).toBeInTheDocument();
    expect(screen.queryByText(/Bonus/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Qualification Round/)).not.toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('hides money without an entry fee', () => {
    render(<EventHeader event={event({ entry_fee_per_player: null })} />);
    expect(screen.queryByText(/^Pot/)).not.toBeInTheDocument();
  });

  it('tracks qualification progress for admins', async () => {
    render(<EventHeader event={event({ qualification_round_enabled: true })} />);
    expect(await screen.findByText('Qualifying · 2 of 3')).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith('/api/event/event-1/qualification', expect.anything());

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ players: [{ is_complete: true }, { is_complete: true }, { is_complete: true }] }),
    });
    act(() => realtime.onChange?.());
    expect(await screen.findByText('Qualifying · 3 of 3')).toBeInTheDocument();
  });

  it('shows no code, payments or money to non-admins', async () => {
    render(<EventHeader event={event({ viewer_is_admin: false, access_code: null, qualification_round_enabled: true })} />);
    expect(screen.queryByText(/Scoring code/)).not.toBeInTheDocument();
    expect(screen.queryByText(/unpaid/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Pot/)).not.toBeInTheDocument();
    await waitFor(() => expect(global.fetch).not.toHaveBeenCalled());
  });

  it('shows the live link and bracket numbers during the bracket', () => {
    render(<EventHeader event={event({ status: 'bracket' })} />);
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Public bracket' })).toHaveAttribute('href', '/event/event-1/bracket');
    expect(screen.getByText('Matches played')).toBeInTheDocument();
    expect(screen.queryByText(/unpaid/)).not.toBeInTheDocument();
  });
});
