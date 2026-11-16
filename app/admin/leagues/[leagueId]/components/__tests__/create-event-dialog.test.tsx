import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { CreateEventDialog } from '../create-event-dialog';
import type { TemplateEvent } from '../create-event-wizard/repeat-event';
import { DEFAULT_EVENT_SETUP, type EventSetupContext } from '@/lib/utils/event-setup';

const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

jest.mock('@/components/ui/calendar', () => ({
  Calendar: ({ onSelect }: { onSelect: (date: Date) => void }) => (
    <button type="button" onClick={() => onSelect(new Date(2030, 0, 1))}>Jan 1 2030</button>
  ),
}));

const ZONES: EventSetupContext = {
  leagueHandicaps: true,
  zones: [
    { zone: 1, distance_ft: 21 },
    { zone: 2, distance_ft: 27 },
    { zone: 3, distance_ft: 33 },
  ],
};

const TEMPLATE: TemplateEvent = {
  ...DEFAULT_EVENT_SETUP,
  handicap_enabled: true,
  id: '11111111-1111-4111-8111-111111111111',
  event_date: '2026-11-10',
  location: 'Brewhouse',
  lane_count: 4,
  qualification_round_enabled: true,
  entry_fee_per_player: 10,
  admin_fee_per_player: 1,
  participant_count: 18,
};

let fetchMock: jest.Mock;

beforeAll(() => {
  // Radix Switch measures itself; jsdom has no ResizeObserver.
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => {
  push.mockReset();
  fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'new-event' }) });
  global.fetch = fetchMock;
});

function postedBody() {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe('/api/league/league-1');
  return JSON.parse(init.body);
}

const next = () => fireEvent.click(screen.getByRole('button', { name: /^(Next|Review)/ }));

async function pickDate() {
  fireEvent.click(screen.getByRole('button', { name: 'Pick the event date' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Jan 1 2030' }));
}

describe('CreateEventDialog: guided steps', () => {
  it('asks only what applies and posts the same body as before', async () => {
    render(<CreateEventDialog leagueId="league-1" leagueName="Tuesday Night" />);
    fireEvent.click(screen.getByRole('button', { name: 'Create Event' }));

    next();
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose a date for the event');
    expect(screen.getByRole('heading', { name: 'When and where?' })).toBeInTheDocument();

    await pickDate();
    next();
    await screen.findByRole('heading', { name: 'How is the night played?' });
    expect(screen.getByText('How are teams formed?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Singles' }));
    expect(screen.queryByText('How are teams formed?')).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Qualification frames' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /^Yes/ }));
    expect(screen.getByRole('group', { name: 'Qualification frames' })).toBeInTheDocument();

    next();
    await screen.findByRole('heading', { name: 'How long and how far?' });
    expect(screen.getByLabelText('Putt distance in feet')).toBeInTheDocument();

    next();
    await screen.findByRole('heading', { name: 'Any fees?' });
    fireEvent.change(screen.getByLabelText('Entry fee per player'), { target: { value: '10' } });

    next();
    await screen.findByRole('heading', { name: 'Ready to create' });
    expect(screen.getByText(/Singles · 5-frame qualification/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create event' }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/admin/event/new-event'));
    const body = postedBody();
    expect(body).toMatchObject({
      event_date: '2030-01-01',
      location: null,
      lane_count: 1,
      putt_distance_ft: 15,
      qualification_round_enabled: true,
      qualification_frame_count: 5,
      bracket_frame_count: 5,
      double_grand_final: true,
      entry_fee_per_player: 10,
      admin_fees: null,
      admin_fee_per_player: null,
      team_size: 1,
      team_assignment: 'random_pairing',
    });
    expect(body.access_code).toMatch(/^[A-Z2-9]{6}$/);
    expect(body).not.toHaveProperty('copy_players_from_event_id');
    expect(body.handicap_enabled).toBe(false);
  });

  it('shows the zone ladder instead of a distance in a handicap league', async () => {
    render(<CreateEventDialog leagueId="league-1" handicap={ZONES} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create Event' }));
    await pickDate();
    next();
    await screen.findByRole('heading', { name: 'How is the night played?' });
    next();
    await screen.findByRole('heading', { name: 'How long and how far?' });
    expect(screen.queryByLabelText('Putt distance in feet')).not.toBeInTheDocument();
    const ladder = screen.getByRole('list', { name: 'Zone distances' });
    expect(within(ladder).getByText('27 ft')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /From handicap zones/ })).toBeChecked();
    expect(screen.getByRole('link', { name: /Handicap settings/ })).toHaveAttribute('target', '_blank');
  });

  it('lets a handicap league run one distance for everyone', async () => {
    render(<CreateEventDialog leagueId="league-1" handicap={ZONES} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create Event' }));
    await pickDate();
    next();
    await screen.findByRole('heading', { name: 'How is the night played?' });
    next();
    await screen.findByRole('heading', { name: 'How long and how far?' });
    fireEvent.click(screen.getByRole('radio', { name: /One distance for everyone/ }));
    expect(screen.queryByRole('list', { name: 'Zone distances' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Putt distance in feet'), { target: { value: '20' } });
    next();
    await screen.findByRole('heading', { name: 'Any fees?' });
    next();
    await screen.findByRole('heading', { name: 'Ready to create' });
    expect(screen.getByText(/20 ft for everyone/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create event' }));

    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(postedBody()).toMatchObject({ handicap_enabled: false, putt_distance_ft: 20 });
  });

  it('returns to review with the server error', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'An event with this access code already exists' }) });
    render(<CreateEventDialog leagueId="league-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Create Event' }));
    await pickDate();
    for (const heading of ['How is the night played?', 'How long and how far?', 'Any fees?', 'Ready to create']) {
      next();
      await screen.findByRole('heading', { name: heading });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Create event' }));
    expect(await screen.findByText('An event with this access code already exists')).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});

describe('CreateEventDialog: repeat last event', () => {
  it('creates a copy of the last event in two clicks', async () => {
    render(
      <CreateEventDialog leagueId="league-1" templateEvent={TEMPLATE} completedEvents={[TEMPLATE]} handicap={ZONES} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create Event' }));
    expect(await screen.findByText('Same as last event')).toBeInTheDocument();
    expect(screen.getByLabelText('Also add its 18 players')).toBeChecked();
    const dates = within(screen.getByRole('radiogroup', { name: 'Event date' })).getAllByRole('radio');
    expect(dates).toHaveLength(2);
    expect(dates[0]).toBeChecked();

    next();
    expect(await screen.findByText(/tap anything underlined/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Lanes: 4 lanes/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Putt distance: each player's handicap zone/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create event' }));

    await waitFor(() => expect(push).toHaveBeenCalled());
    const body = postedBody();
    expect(body).toMatchObject({
      location: 'Brewhouse',
      lane_count: 4,
      qualification_round_enabled: true,
      entry_fee_per_player: 10,
      admin_fee_per_player: 1,
      handicap_enabled: true,
      copy_players_from_event_id: TEMPLATE.id,
    });
    // Next Tuesday on or after today.
    expect(new Date(`${body.event_date}T00:00:00`).getDay()).toBe(2);
  });

  it('can drop the players and edit a value in place', async () => {
    render(<CreateEventDialog leagueId="league-1" templateEvent={TEMPLATE} completedEvents={[TEMPLATE]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create Event' }));
    next();
    await screen.findByText(/tap anything underlined/);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    fireEvent.click(screen.getByRole('button', { name: /^Lanes: 4 lanes/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'More lanes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(await screen.findByRole('button', { name: /^Lanes: 5 lanes/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create event' }));
    await waitFor(() => expect(push).toHaveBeenCalled());
    const body = postedBody();
    expect(body.lane_count).toBe(5);
    expect(body).not.toHaveProperty('copy_players_from_event_id');
  });

  it('repeats a one-distance night as one distance', async () => {
    render(
      <CreateEventDialog
        leagueId="league-1"
        templateEvent={{ ...TEMPLATE, handicap_enabled: false, putt_distance_ft: 20 }}
        handicap={ZONES}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create Event' }));
    expect(await screen.findByText('20 ft for everyone')).toBeInTheDocument();
    next();
    expect(await screen.findByRole('button', { name: /^Putt distance: 20 ft for everyone/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create event' }));
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(postedBody()).toMatchObject({ handicap_enabled: false, putt_distance_ft: 20 });
  });

  it('falls through to the guided steps from scratch', async () => {
    render(<CreateEventDialog leagueId="league-1" templateEvent={TEMPLATE} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create Event' }));
    fireEvent.click(await screen.findByRole('radio', { name: /Set up from scratch/ }));
    next();
    expect(await screen.findByRole('heading', { name: 'When and where?' })).toBeInTheDocument();
    expect(screen.getByLabelText('Location (optional)')).toHaveValue('Brewhouse');
  });
});
