import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { ZoneSeedCandidate, ZoneSeedData, ZoneSeedSource } from '@/lib/types/handicap';
import { ZoneSeeding } from '../zone-seeding';

jest.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: jest.fn() }) }));

jest.mock('../zone-cut-histogram', () => ({
  ...jest.requireActual('../zone-cut-histogram'),
  ZoneCutHistogram: () => null,
}));

jest.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, disabled, children }: {
    value: string;
    onValueChange: (value: string) => void;
    disabled?: boolean;
    children: ReactNode;
  }) => (
    <select aria-label="Source league" value={value} disabled={disabled} onChange={(event) => onValueChange(event.target.value)}>
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => <option value={value}>{children}</option>,
  SelectTrigger: () => null,
  SelectValue: () => null,
}));

const DATES = { from: '2026-01-01', to: '2026-06-01' };
const SOURCES: ZoneSeedSource[] = [
  { league_id: 'big', league_name: 'Big League', events: 10, ...DATES },
  { league_id: 'small', league_name: 'Small League', events: 2, ...DATES },
  { league_id: 'third', league_name: 'Third League', events: 1, ...DATES },
];

function candidate(id: string, points: number): ZoneSeedCandidate {
  return {
    player_id: id,
    player_name: `Player ${id}`,
    player_number: 1,
    history: { frames: 50, matches: 10, events: 2, points: points * 10, points_per_match: points },
    eligible: true,
    current_zone: null,
  };
}

function seedData(sourceId: string, candidates: ZoneSeedCandidate[], sources = SOURCES): ZoneSeedData {
  return {
    default_zone: 2,
    zones: [
      { zone: 1, distance_ft: 21 },
      { zone: 2, distance_ft: 27 },
      { zone: 3, distance_ft: 33 },
    ],
    settings: { min_putts: 0, min_matches: 0 },
    sources,
    source: sources.find((source) => source.league_id === sourceId) ?? null,
    candidates,
    locked_count: 0,
  };
}

const FIELD = [candidate('a', 2), candidate('b', 9), candidate('c', 18)];

/** Each GET stays pending until the test resolves it, so responses can land in any order. */
function deferredFetch() {
  const pending: Array<{ url: string; respond: (body: ZoneSeedData | null) => void }> = [];
  global.fetch = jest.fn((url: string) => new Promise((resolve) => {
    pending.push({
      url,
      respond: (body) => resolve({ ok: body !== null, json: async () => body } as Response),
    });
  })) as unknown as typeof fetch;
  return pending;
}

async function renderOpen(pending: ReturnType<typeof deferredFetch>, first: ZoneSeedData) {
  render(<ZoneSeeding leagueId="league" onChanged={jest.fn()} />);
  await waitFor(() => expect(pending).toHaveLength(1));
  pending[0].respond(first);
  fireEvent.click(await screen.findByRole('button', { name: /set starting zones/i }));
}

const applyButton = () => screen.getByRole('button', { name: /^apply/i });
const pickSource = (id: string) => fireEvent.change(screen.getByLabelText('Source league'), { target: { value: id } });

describe('ZoneSeeding', () => {
  it('keeps the source picker when the default source has nobody to place', async () => {
    const pending = deferredFetch();
    await renderOpen(pending, seedData('big', []));

    expect(screen.getByText('Nobody from Big League is left to place.')).toBeInTheDocument();
    pickSource('small');
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(pending[1].url).toContain('source_league_id=small');
    pending[1].respond(seedData('small', FIELD));
    await waitFor(() => expect(applyButton()).toBeEnabled());
  });

  it('hides the card when there is nobody to place and no other source', async () => {
    const pending = deferredFetch();
    const { container } = render(<ZoneSeeding leagueId="league" onChanged={jest.fn()} />);
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => {
      pending[0].respond(seedData('big', [], SOURCES.slice(0, 1)));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container).toBeEmptyDOMElement();
  });

  it('blocks Apply and Review until the picked source has loaded', async () => {
    const pending = deferredFetch();
    await renderOpen(pending, seedData('big', FIELD));
    await waitFor(() => expect(applyButton()).toBeEnabled());

    pickSource('small');
    expect(screen.getByLabelText('Source league')).toHaveValue('small');
    expect(applyButton()).toBeDisabled();
    expect(screen.getByRole('button', { name: /^review/i })).toBeDisabled();

    await waitFor(() => expect(pending).toHaveLength(2));
    pending[1].respond(seedData('small', FIELD));
    await waitFor(() => expect(applyButton()).toBeEnabled());
  });

  it('drops a slower response for a source the admin has left', async () => {
    const pending = deferredFetch();
    await renderOpen(pending, seedData('big', FIELD));
    await waitFor(() => expect(applyButton()).toBeEnabled());

    pickSource('small');
    pickSource('third');
    await waitFor(() => expect(pending).toHaveLength(3));
    pending[2].respond(seedData('third', FIELD));
    await waitFor(() => expect(applyButton()).toBeEnabled());
    await act(async () => {
      pending[1].respond(seedData('small', [candidate('z', 5)]));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(screen.getByLabelText('Source league')).toHaveValue('third');
    expect(screen.getByRole('button', { name: /^review/i })).toHaveTextContent('Review 3 players');
  });

  it('returns to the loaded source when the switch fails', async () => {
    const pending = deferredFetch();
    await renderOpen(pending, seedData('big', FIELD));
    await waitFor(() => expect(applyButton()).toBeEnabled());

    pickSource('small');
    await waitFor(() => expect(pending).toHaveLength(2));
    pending[1].respond(null);

    expect(await screen.findByText('Failed to load past scoring')).toBeInTheDocument();
    expect(screen.getByLabelText('Source league')).toHaveValue('big');
    expect(applyButton()).toBeEnabled();
  });
});
