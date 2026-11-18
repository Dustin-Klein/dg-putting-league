import { Status } from 'brackets-model';
import { isMatchClickable } from '../bracket-view';

describe('isMatchClickable', () => {
  describe('read-only (public) view', () => {
    const ctx = { isEditMode: false, readOnly: true };

    it('opens finished matches once the event is completed', () => {
      expect(isMatchClickable(Status.Completed, { ...ctx, eventStatus: 'completed' })).toBe(true);
      expect(isMatchClickable(Status.Archived, { ...ctx, eventStatus: 'completed' })).toBe(true);
    });

    it('opens finished and running matches during bracket play', () => {
      expect(isMatchClickable(Status.Completed, { ...ctx, eventStatus: 'bracket' })).toBe(true);
      expect(isMatchClickable(Status.Running, { ...ctx, eventStatus: 'bracket' })).toBe(true);
    });

    it('does not open matches without scores', () => {
      for (const status of [Status.Locked, Status.Waiting, Status.Ready]) {
        expect(isMatchClickable(status, { ...ctx, eventStatus: 'bracket' })).toBe(false);
      }
    });
  });

  describe('admin view', () => {
    it('only allows score corrections while the bracket is live', () => {
      const ctx = { isEditMode: false, readOnly: false };
      expect(isMatchClickable(Status.Completed, { ...ctx, eventStatus: 'bracket' })).toBe(true);
      expect(isMatchClickable(Status.Completed, { ...ctx, eventStatus: 'completed' })).toBe(false);
      expect(isMatchClickable(Status.Ready, { ...ctx, eventStatus: 'bracket' })).toBe(true);
    });

    it('opens waiting matches only in edit mode', () => {
      expect(isMatchClickable(Status.Waiting, { isEditMode: false, readOnly: false, eventStatus: 'bracket' })).toBe(false);
      expect(isMatchClickable(Status.Waiting, { isEditMode: true, readOnly: false, eventStatus: 'bracket' })).toBe(true);
    });
  });
});
