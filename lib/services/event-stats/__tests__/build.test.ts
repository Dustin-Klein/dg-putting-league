import { Status } from 'brackets-model';
import { buildEventStats } from '../build';
import { buildEntryFlags, buildAnalytics, buildEvaluations, buildQualification } from '../admin';
import { toPublicEventStats } from '../public-mapper';
import { completed, entry, eventRow, frames, match, snapshot } from './fixtures';

const doubles = () => ({
  entries: [entry('a1', 'A'), entry('a2', 'A', { slot: 2 }), entry('b1', 'B'), entry('b2', 'B', { slot: 2 })],
  teams: [{ id: 'A', seed: 1, placement: null }, { id: 'B', seed: 2, placement: null }],
});

describe('buildEventStats', () => {
  it('reconciles player, team, zone and field totals from raw counts', () => {
    const m1 = completed('A', 'B', 30, 10, { id: 1 });
    const s = snapshot({
      ...doubles(),
      matches: [m1],
      frames: [frames('a1', 1, 5, 3), frames('a2', 1, 5, 2), frames('b1', 1, 5, 1), frames('b2', 1, 5, 1)],
    });
    const { report, teams } = buildEventStats(s, null);

    expect(report.field.frames).toBe(20);
    expect(report.field.made).toBe(15 + 10 + 5 + 5);
    expect(report.field.make_rate).toBeCloseTo(35 / 60);
    expect(report.field.points_per_match).toBeCloseTo(((20 + 10 + 5 + 5) / 20) * 5);
    const a1 = report.players.find((p) => p.entry_id === 'a1')!;
    expect(a1.line.points).toBe(20);
    expect(a1.line.threes).toBe(5);
    expect(a1.matches).toBe(1);
    expect(a1.small_sample).toBe(true);
    expect(a1.best_match).toBeNull();
    const teamA = report.standings.find((t) => t.team_id === 'A')!;
    expect(teamA.line.make_rate).toBeCloseTo(25 / 30);
    expect(teamA.line.points_per_match).toBe(30);
    expect(teamA.wins).toBe(1);
    expect(teams.find((t) => t.team_id === 'B')!.losses).toBe(1);
    expect(report.zone_groups).toHaveLength(1);
    expect(report.zone_groups[0].line.frames).toBe(20);
    expect(report.zone_groups[0].mix).toEqual([0, 10, 5, 5]);
  });

  it('excludes BYEs and the unused grand-final reset from match counts', () => {
    const bye = completed('A', 'B', 0, 0, { id: 2 });
    const s = snapshot({
      ...doubles(),
      matches: [
        completed('A', 'B', 20, 10, { id: 1 }),
        { ...bye, opponent2: null },
        match('A', 'B', { id: 3, status: Status.Archived, group_number: 3, round_number: 2, opponent1: { id: 1 }, opponent2: { id: 2 } }),
        match('A', 'B', { id: 4, status: Status.Locked, group_number: 3, round_number: 2 }),
      ],
      frames: [frames('a1', 1, 5, 2), frames('b1', 1, 5, 1)],
    });
    const { report } = buildEventStats(s, null);
    expect(report.progress).toEqual({ completed: 1, in_progress: 0, total: 1 });
    expect(report.standings.find((t) => t.team_id === 'A')!.wins).toBe(1);
  });

  it('counts overtime frames for players but not in the highest regulation score', () => {
    const s = snapshot({
      ...doubles(),
      event: eventRow({ bracket_frame_count: 5 }),
      matches: [completed('A', 'B', 23, 22, { id: 1 })],
      frames: [
        frames('a1', 1, 5, 2), frames('a2', 1, 5, 2), frames('b1', 1, 5, 2), frames('b2', 1, 5, 2),
        // Partial sudden death: only one member of each team putts.
        frames('a1', 1, 1, 3, { overtime: true }), frames('b1', 1, 1, 2, { overtime: true }),
      ],
    });
    const { report } = buildEventStats(s, null);
    expect(report.overtime_matches).toBe(1);
    expect(report.close_matches).toBe(1);
    expect(report.players.find((p) => p.entry_id === 'a1')!.line.frames).toBe(6);
    expect(report.players.find((p) => p.entry_id === 'a2')!.line.frames).toBe(5);
    expect(report.matches.highest).toMatchObject({ score1: 20, score2: 20, overtime: true });
    expect(report.matches.closest).toMatchObject({ score1: 23, score2: 22 });
  });

  it('uses overrides for results only: manual-only adds no player stats, conflicts are flagged', () => {
    const s = snapshot({
      ...doubles(),
      matches: [
        completed('A', 'B', 27, 24, { id: 1, score_override_1: 27, score_override_2: 24 }),
        completed('B', 'A', 15, 14, { id: 2, score_override_1: 15, score_override_2: 14 }),
      ],
      frames: [frames('a1', 1, 5, 2), frames('a2', 1, 5, 2), frames('b1', 1, 5, 2), frames('b2', 1, 5, 2)],
    });
    const { report, warnings } = buildEventStats(s, null);
    expect(report.matches.completed).toBe(2);
    expect(report.field.frames).toBe(20);
    expect(report.players.find((p) => p.entry_id === 'a1')!.matches).toBe(1);
    expect(report.standings.find((t) => t.team_id === 'A')).toMatchObject({ wins: 1, losses: 1 });
    expect(warnings.map((w) => w.kind).sort()).toEqual(['manual_only', 'override_conflict']);
    expect(report.matches.highest).toMatchObject({ match_id: 1, score1: 27, score2: 24 });
  });

  it('flags zero-frame members and counts them as 0 in the team metric', () => {
    const s = snapshot({
      ...doubles(),
      matches: [completed('A', 'B', 20, 10, { id: 1 })],
      frames: [frames('a1', 1, 5, 3), frames('b1', 1, 5, 1), frames('b2', 1, 5, 1)],
    });
    const { report, warnings, teams } = buildEventStats(s, null);
    expect(report.standings.find((t) => t.team_id === 'A')!.line.points_per_match).toBe(20);
    expect(teams.find((t) => t.team_id === 'A')!.zero_frame_members).toEqual(['Player a2']);
    expect(warnings.filter((w) => w.kind === 'zero_frames')).toHaveLength(2);
  });

  it('handles teams of 1 and 3', () => {
    const singles = snapshot({
      event: eventRow({ team_size: 1, bracket_format: 'single_elimination', double_grand_final: false }),
      entries: [entry('a1', 'A'), entry('b1', 'B')],
      teams: [{ id: 'A', seed: 1, placement: null }, { id: 'B', seed: 2, placement: null }],
      matches: [completed('A', 'B', 12, 8, { id: 1 })],
      frames: [frames('a1', 1, 5, 2), frames('b1', 1, 4, 2)],
    });
    const one = buildEventStats(singles, null).report;
    expect(one.standings[0].line.points_per_match).toBe(one.players.find((p) => p.entry_id === 'a1')!.line.points_per_match);
    expect(one.standings.find((t) => t.team_id === 'A')!.status).toBe('in');
    expect(one.standings.find((t) => t.team_id === 'B')!.status).toBe('out');

    const triples = snapshot({
      event: eventRow({ team_size: 3 }),
      entries: [entry('a1', 'A'), entry('a2', 'A', { slot: 2 }), entry('a3', 'A', { slot: 3 }), entry('b1', 'B'), entry('b2', 'B', { slot: 2 }), entry('b3', 'B', { slot: 3 })],
      teams: [{ id: 'A', seed: 1, placement: null }, { id: 'B', seed: 2, placement: null }],
      matches: [completed('A', 'B', 30, 15, { id: 1 })],
      frames: ['a1', 'a2', 'a3'].map((e) => frames(e, 1, 5, 2)).concat(['b1', 'b2', 'b3'].map((e) => frames(e, 1, 5, 1))),
    });
    const three = buildEventStats(triples, null).report;
    expect(three.standings.find((t) => t.team_id === 'A')!.line.points_per_match).toBe(30);
    expect(three.standings.find((t) => t.team_id === 'A')!.members).toHaveLength(3);
  });

  it('shows live status and progress, and placement only after completion', () => {
    const live = snapshot({
      ...doubles(),
      matches: [match('A', 'B', { id: 1, status: Status.Running, lane_label: 'Lane 1' })],
      frames: [frames('a1', 1, 2, 2), frames('b1', 1, 2, 1)],
    });
    const l = buildEventStats(live, null).report;
    expect(l.progress).toEqual({ completed: 0, in_progress: 1, total: 1 });
    expect(l.standings.every((t) => t.status === 'playing' && t.lane === 'Lane 1')).toBe(true);
    expect(l.matches.completed).toBe(0);
    expect(l.field.frames).toBe(4);

    const done = snapshot({
      ...doubles(),
      event: eventRow({ status: 'completed' }),
      teams: [{ id: 'A', seed: 1, placement: 2 }, { id: 'B', seed: 2, placement: 1 }],
      matches: [completed('B', 'A', 20, 10, { id: 1 })],
      frames: [frames('a1', 1, 5, 1), frames('b1', 1, 5, 2)],
    });
    const d = buildEventStats(done, null).report;
    expect(d.standings.map((t) => [t.team_id, t.placement, t.status])).toEqual([['B', 1, null], ['A', 2, null]]);
  });

  it('groups zones by the distance actually putted and picks a per-zone best with 10+ frames', () => {
    const s = snapshot({
      event: eventRow({ handicap_enabled: true }),
      entries: [
        entry('a1', 'A', { zone: 2, putt_distance_ft: 27 }),
        entry('a2', 'A', { zone: 2, putt_distance_ft: 25, slot: 2 }),
        entry('b1', 'B', { zone: 1, putt_distance_ft: 21 }),
        entry('b2', 'B', { zone: 2, putt_distance_ft: 27, slot: 2 }),
      ],
      teams: [{ id: 'A', seed: 1, placement: null }, { id: 'B', seed: 2, placement: null }],
      zoneDistances: [{ zone: 1, distance_ft: 21 }, { zone: 2, distance_ft: 27 }],
      matches: [completed('A', 'B', 20, 10, { id: 1 }), completed('A', 'B', 20, 10, { id: 2 })],
      frames: [
        frames('a1', 1, 5, 3, { zone: 2, distance: 27 }), frames('a1', 2, 5, 2, { zone: 2, distance: 27 }),
        frames('a2', 1, 5, 2, { zone: 2, distance: 25 }), frames('a2', 2, 5, 2, { zone: 2, distance: 25 }),
        frames('b1', 1, 5, 1, { zone: 1, distance: 21 }), frames('b1', 2, 5, 1, { zone: 1, distance: 21 }),
        frames('b2', 1, 5, 1, { zone: 2, distance: 27 }),
      ],
    });
    const { report } = buildEventStats(s, null);
    expect(report.zone_groups.map((g) => [g.zone, g.distance_ft, g.off_nominal, g.players])).toEqual([
      [1, 21, false, 1], [2, 27, false, 2], [2, 25, true, 1],
    ]);
    expect(report.zone_groups[1].best).toMatchObject({ name: 'Player a1' });
    expect(report.zones).toEqual([{ zone: 1, distance_ft: 21, players: 1 }, { zone: 2, distance_ft: 27, players: 3 }]);
    expect(report.players.find((p) => p.entry_id === 'a1')!.best_match).toBe(20);
  });

  it('hides putt-based numbers for imported points-only events', () => {
    const s = snapshot({
      ...doubles(),
      event: eventRow({ putt_counts_reliable: false }),
      matches: [completed('A', 'B', 15, 10, { id: 1 })],
      frames: [frames('a1', 1, 5, 3, { bonus: false }), frames('b1', 1, 5, 2)],
    });
    const { report, warnings } = buildEventStats(s, null);
    expect(report.field).toMatchObject({ made: null, threes: null, make_rate: null, points: 25 });
    expect(report.zone_groups[0].mix).toBeNull();
    expect(warnings[0].kind).toBe('unreliable_putts');
  });
});

describe('admin report pieces', () => {
  it('flags excluded entries, overrides and entries whose distance is not the zone distance', () => {
    const s = snapshot({
      event: eventRow({ handicap_enabled: true }),
      entries: [entry('a1', 'A', { zone: 2, putt_distance_ft: 25 }), entry('a2', 'A', { zone: 2, putt_distance_ft: 32 }), entry('a3', 'A', { zone: 2, putt_distance_ft: 27 })],
      zoneDistances: [{ zone: 2, distance_ft: 27 }],
      matches: [],
    });
    const admin = {
      hasQualificationRound: true,
      entries: [
        { id: 'a1', exclude_from_handicap: false, handicap_note: 'short lane', distance_override: true, qualification_frames: 5, qualification_made: 10, qualification_points: 11 },
        { id: 'a2', exclude_from_handicap: false, handicap_note: null, distance_override: false, qualification_frames: 0, qualification_made: 0, qualification_points: 0 },
        { id: 'a3', exclude_from_handicap: true, handicap_note: 'injury', distance_override: false, qualification_frames: 0, qualification_made: 0, qualification_points: 0 },
      ],
    };
    expect(buildEntryFlags(s, admin).map((f) => [f.entry_id, f.flag, f.note])).toEqual([
      ['a1', 'distance_override', 'short lane'],
      ['a2', 'distance_mismatch', null],
      ['a3', 'excluded', 'injury'],
    ]);
    expect(buildQualification(s, admin)).toEqual([
      { entry_id: 'a1', name: 'Player a1', frames: 5, made: 10, points: 11, make_rate: 10 / 15 },
    ]);
    expect(buildQualification(s, { ...admin, hasQualificationRound: false })).toBeNull();
  });

  it('labels evaluations as pending until completion', () => {
    expect(buildEvaluations('bracket', true, []).state).toBe('pending');
    expect(buildEvaluations('completed', false, []).state).toBe('none');
  });

  it('computes spread, strength vs. finish and the league range', () => {
    const s = snapshot({
      ...doubles(),
      event: eventRow({ status: 'completed' }),
      teams: [{ id: 'A', seed: 1, placement: 1 }, { id: 'B', seed: 2, placement: 2 }],
      matches: [completed('A', 'B', 40, 20, { id: 1 }), completed('A', 'B', 40, 20, { id: 2 })],
      frames: [1, 2].flatMap((m) => [frames('a1', m, 5, 3), frames('a2', m, 5, 3), frames('b1', m, 5, 2), frames('b2', m, 5, 2)]),
    });
    const model = buildEventStats(s, null);
    const counts = (frames: number, points: number) => ({ counts: { frames, points, reliableFrames: frames, reliableMade: points }, line: { label: '', frames, make_rate: null, points_per_match: null } });
    const season = {
      field: null,
      players: new Map([
        ['player-a1', counts(10, 30)], ['player-a2', counts(10, 30)],
        ['player-b1', counts(10, 20)], ['player-b2', counts(0, 0)],
      ]),
    };
    const analytics = buildAnalytics({
      snapshot: s,
      entryStats: model.entryStats,
      teams: model.teams,
      season,
      history: [
        { event_id: 'old', entry_id: 'x1', team_id: 'X', frames_per_match: 5, frames: 10, points: 30 },
        { event_id: 'old', entry_id: 'x2', team_id: 'Y', frames_per_match: 5, frames: 10, points: 10 },
      ],
    });
    expect(analytics.spread.player_ppf_sd).toBeCloseTo(1);
    expect(analytics.spread.league_player_ppf_sd).toEqual({ min: 2 / 2 * 1, max: 1, events: 1 });
    expect(analytics.strength).toMatchObject({ available: true, teams_counted: 1, teams_without_history: 1 });
    expect(analytics.scatter.map((p) => p.entry_id)).toEqual(['a1', 'a2', 'b1']);
  });
});

describe('toPublicEventStats', () => {
  it('copies only allowlisted fields and links a child only once it is public', () => {
    const s = snapshot({ ...doubles(), matches: [completed('A', 'B', 20, 10, { id: 1 })], frames: [frames('a1', 1, 5, 2)] });
    const model = buildEventStats(s, null);
    (model.report.players[0] as unknown as Record<string, unknown>).handicap_note = 'leak';
    (model.report as unknown as Record<string, unknown>).warnings = model.warnings;
    const hidden = toPublicEventStats(model, { parent: null, children: [{ id: 'c', status: 'created', event_date: '2026-11-20', link_type: 'second_chance' }] }, 'now');
    expect(JSON.stringify(hidden)).not.toContain('leak');
    expect(hidden).not.toHaveProperty('warnings');
    expect(hidden.child).toBeNull();
    const shown = toPublicEventStats(model, { parent: null, children: [{ id: 'c', status: 'bracket', event_date: '2026-11-20', link_type: 'second_chance' }] }, 'now');
    expect(shown.child).toEqual({ id: 'c', link_type: 'second_chance', event_date: '2026-11-20' });
  });
});
