/**
 * @jest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react';
import { useCoalescedRefresh, REFRESH_COALESCE_MS } from '../use-coalesced-refresh';

interface Deferred {
  signal: AbortSignal;
  resolve: () => void;
  reject: (error: Error) => void;
}

function controllableLoad() {
  const calls: Deferred[] = [];
  const load = jest.fn(
    (signal: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        calls.push({ signal, resolve, reject });
      })
  );
  return { load, calls };
}

async function settle(deferred: Deferred, outcome: 'resolve' | 'reject' = 'resolve') {
  await act(async () => {
    if (outcome === 'resolve') deferred.resolve();
    else deferred.reject(new Error('boom'));
  });
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('useCoalescedRefresh', () => {
  it('turns a burst of changes during a slow read into one active read and one follow-up', async () => {
    const { load, calls } = controllableLoad();
    const { result } = renderHook(() => useCoalescedRefresh(load, 'event-1'));

    act(() => result.current.refresh());
    expect(load).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 20; i++) {
      act(() => {
        result.current.request();
        jest.advanceTimersByTime(REFRESH_COALESCE_MS);
      });
    }
    expect(load).toHaveBeenCalledTimes(1);

    await settle(calls[0]);
    expect(load).toHaveBeenCalledTimes(2);

    await settle(calls[1]);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('coalesces changes arriving within the window into one read', () => {
    const { load } = controllableLoad();
    const { result } = renderHook(() => useCoalescedRefresh(load, 'event-1'));

    act(() => {
      for (let i = 0; i < 5; i++) result.current.request();
    });
    expect(load).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(REFRESH_COALESCE_MS));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('retries after a failed read', async () => {
    const { load, calls } = controllableLoad();
    const { result } = renderHook(() => useCoalescedRefresh(load, 'event-1'));

    act(() => result.current.refresh());
    await settle(calls[0], 'reject');
    act(() => result.current.refresh());
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('aborts an invalidated read and still runs the follow-up for changes seen during it', async () => {
    const { load, calls } = controllableLoad();
    const { result } = renderHook(() => useCoalescedRefresh(load, 'event-1'));

    act(() => result.current.refresh());
    act(() => result.current.request());
    act(() => jest.advanceTimersByTime(REFRESH_COALESCE_MS)); // seen during the read: dirty

    act(() => result.current.invalidate());
    expect(calls[0].signal.aborted).toBe(true);

    act(() => jest.advanceTimersByTime(REFRESH_COALESCE_MS));
    expect(load).toHaveBeenCalledTimes(2);
    expect(calls[1].signal.aborted).toBe(false);

    // The obsolete read settling later doesn't start anything else.
    await settle(calls[0]);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('abandons pending work when the resource changes or the component unmounts', async () => {
    const { load, calls } = controllableLoad();
    const { result, rerender, unmount } = renderHook(({ key }) => useCoalescedRefresh(load, key), {
      initialProps: { key: 'event-1' },
    });

    act(() => result.current.refresh());
    act(() => result.current.request());
    rerender({ key: 'event-2' });
    expect(calls[0].signal.aborted).toBe(true);
    act(() => jest.advanceTimersByTime(REFRESH_COALESCE_MS));
    expect(load).toHaveBeenCalledTimes(1);

    act(() => result.current.refresh());
    expect(load).toHaveBeenCalledTimes(2);
    unmount();
    expect(calls[1].signal.aborted).toBe(true);
    act(() => result.current.request());
    act(() => jest.advanceTimersByTime(REFRESH_COALESCE_MS));
    expect(load).toHaveBeenCalledTimes(2);
  });
});
