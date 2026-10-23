import {act, renderHook} from '@testing-library/react-native';
import * as Kepler from '@amazon-devices/react-native-kepler';

import {resetInboxCache, useLinkInbox} from '../../src/hooks/useLinkInbox';
import {ApiError, listLinkMedia, listMessages} from '../../src/services/api';

jest.mock('../../src/services/api', () => ({
  ...jest.requireActual('../../src/services/api'),
  listMessages: jest.fn(),
  listLinkMedia: jest.fn(),
}));

const listMessagesMock = listMessages as jest.Mock;
const listMediaMock = listLinkMedia as jest.Mock;
const LINK = '01JLINK0000000000000000000';

const message = (id: string, at: string) => ({
  id,
  at,
  from: {kind: 'phone' as const, name: 'Phone'},
  kind: 'text' as const,
  text: id,
});

// The app-state listener the hook registered most recently.
const lastAppStateListener = () => {
  // The setup's mock returns one shared manager object; not a hook call.
  const manager = Kepler.useKeplerAppStateManager;
  const calls = (manager().addAppStateListener as unknown as jest.Mock).mock
    .calls;
  return calls[calls.length - 1][1] as (s: string) => void;
};

const flush = () =>
  act(async () => {
    await Promise.resolve();
  });
const advance = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });

describe('useLinkInbox', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetInboxCache();
    listMessagesMock.mockReset();
    listMediaMock.mockReset();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('polls every 4 s from the cursor and de-duplicates by id', async () => {
    listMessagesMock
      .mockResolvedValueOnce({
        messages: [message('01JA', '2026-10-22T10:00:00Z')],
        cursor: '01JA',
      })
      .mockResolvedValue({
        // The server repeats one: the TV keeps one copy.
        messages: [
          message('01JA', '2026-10-22T10:00:00Z'),
          message('01JB', '2026-10-22T10:01:00Z'),
        ],
        cursor: '01JB',
      });
    listMediaMock.mockResolvedValue([]);

    const {result, unmount} = renderHook(() => useLinkInbox(LINK));
    await flush();
    expect(result.current.thread).toBe('ok');
    expect(result.current.messages.map((m) => m.id)).toEqual(['01JA']);
    expect(listMessagesMock).toHaveBeenCalledTimes(1);
    expect(listMessagesMock.mock.calls[0][1]).toBeUndefined();

    await advance(3900);
    expect(listMessagesMock).toHaveBeenCalledTimes(1);
    await advance(100);
    expect(listMessagesMock).toHaveBeenCalledTimes(2);
    expect(listMessagesMock.mock.calls[1][1]).toBe('01JA');
    expect(result.current.messages.map((m) => m.id)).toEqual(['01JA', '01JB']);

    unmount();
    await advance(20000);
    expect(listMessagesMock).toHaveBeenCalledTimes(2); // stopped on unmount
  });

  it('stops in the background and resumes in the foreground', async () => {
    listMessagesMock.mockResolvedValue({messages: [], cursor: undefined});
    listMediaMock.mockResolvedValue([]);
    const {unmount} = renderHook(() => useLinkInbox(LINK));
    await flush();
    expect(listMessagesMock).toHaveBeenCalledTimes(1);

    await act(async () => lastAppStateListener()('background'));
    await advance(20000);
    expect(listMessagesMock).toHaveBeenCalledTimes(1);

    await act(async () => lastAppStateListener()('active'));
    await flush();
    expect(listMessagesMock).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('does not poll without a link', async () => {
    const {result} = renderHook(() => useLinkInbox(null));
    await advance(10000);
    expect(listMessagesMock).not.toHaveBeenCalled();
    expect(result.current.messages).toEqual([]);
  });

  it('marks uploads unavailable when the media route is missing, and keeps the thread', async () => {
    listMessagesMock.mockResolvedValue({
      messages: [message('01JA', '2026-10-22T10:00:00Z')],
      cursor: '01JA',
    });
    listMediaMock.mockRejectedValue(new ApiError(404, 'not_found', 'HTTP 404'));
    const {result, unmount} = renderHook(() => useLinkInbox(LINK));
    await flush();
    expect(result.current.uploads).toBe('unavailable');
    expect(result.current.thread).toBe('ok');
    expect(result.current.messages).toHaveLength(1);
    unmount();
  });

  it('backs off after thread failures', async () => {
    listMessagesMock.mockRejectedValue(new ApiError(0, 'unreachable', 'x'));
    listMediaMock.mockResolvedValue([]);
    const {result, unmount} = renderHook(() => useLinkInbox(LINK));
    await flush();
    expect(result.current.thread).toBe('error');
    await advance(4000);
    expect(listMessagesMock).toHaveBeenCalledTimes(1); // waits 8 s now
    await advance(4000);
    expect(listMessagesMock).toHaveBeenCalledTimes(2);
    unmount();
  });
});
