import {
  isBracketPubliclyVisible,
  isEventPubliclyVisible,
  isLanesPubliclyVisible,
  isQualificationPubliclyVisible,
} from '../auth/visibility';
import type { EventStatus } from '@/lib/types/event';

const event = (status: EventStatus, qualification_round_enabled = false) => ({
  status,
  qualification_round_enabled,
});

describe('visibility', () => {
  it('shows events once scoring starts', () => {
    expect(isEventPubliclyVisible(event('created', true))).toBe(false);
    expect(isEventPubliclyVisible(event('pre-bracket'))).toBe(false);
    expect(isEventPubliclyVisible(event('pre-bracket', true))).toBe(true);
    expect(isEventPubliclyVisible(event('bracket'))).toBe(true);
    expect(isEventPubliclyVisible(event('completed'))).toBe(true);
  });

  it('shows brackets during and after bracket play', () => {
    expect(isBracketPubliclyVisible(event('pre-bracket', true))).toBe(false);
    expect(isBracketPubliclyVisible(event('bracket'))).toBe(true);
    expect(isBracketPubliclyVisible(event('completed'))).toBe(true);
  });

  it('shows lanes only during bracket play', () => {
    expect(isLanesPubliclyVisible(event('bracket'))).toBe(true);
    expect(isLanesPubliclyVisible(event('completed'))).toBe(false);
  });

  it('shows qualification only while it runs', () => {
    expect(isQualificationPubliclyVisible(event('pre-bracket', true))).toBe(true);
    expect(isQualificationPubliclyVisible(event('pre-bracket'))).toBe(false);
    expect(isQualificationPubliclyVisible(event('bracket', true))).toBe(false);
  });
});
