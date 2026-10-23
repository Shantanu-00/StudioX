import 'react-native';
import {act, render} from '@testing-library/react-native';
import * as React from 'react';
import {
  useKeplerAppStateManager,
  useTVEventHandler,
} from '@amazon-devices/react-native-kepler';
import {VideoPlayer} from '@amazon-devices/react-native-w3cmedia';

import {
  INTRO_SRC,
  Intro,
  SAFETY_MS,
  START_TIMEOUT_MS,
} from '../../src/screens/Intro';

// The setup mock records players and their listeners (test/setup.ts).
type MockPlayer = VideoPlayer & {
  emit: (type: string) => void;
  setSurfaceHandle: jest.Mock;
  deinitialize: jest.Mock;
  initialize: jest.Mock;
};
const players = () =>
  (VideoPlayer as unknown as {instances: MockPlayer[]}).instances;
const lastPlayer = () => players()[players().length - 1];

// A full press: key-down (0) then key-up (1). The intro acts on key-up.
const key = (eventType: string, eventKeyAction: number) => {
  const calls = (useTVEventHandler as unknown as jest.Mock).mock.calls;
  act(() => {
    calls[calls.length - 1][0]({eventType, eventKeyAction});
  });
};
const press = (eventType: string) => {
  key(eventType, 0);
  key(eventType, 1);
};

// Lets the async initialize() chain and queued teardowns settle.
const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
};

const mount = async () => {
  const onDone = jest.fn();
  const screen = render(<Intro onDone={onDone} />);
  await flush();
  act(() => {
    screen.getByTestId('intro-video').props.onSurfaceViewCreated('surface-1');
  });
  return {screen, onDone, player: lastPlayer()};
};

beforeAll(() => jest.useFakeTimers());
afterAll(() => jest.useRealTimers());
beforeEach(() => {
  players().length = 0;
  (useTVEventHandler as unknown as jest.Mock).mockClear();
});

describe('Intro', () => {
  it('renders the video surface and plays the bundled v5 file, muted', async () => {
    const {screen, player} = await mount();
    expect(screen.getByTestId('intro-video')).toBeTruthy();
    expect(screen.queryByTestId('intro-native')).toBeNull();
    expect(player.initialize).toHaveBeenCalledTimes(1);
    expect(player.setSurfaceHandle).toHaveBeenCalledWith('surface-1');
    expect(player.src).toBe(INTRO_SRC);
    expect(player.muted).toBe(true);
    expect(player.autoplay).toBe(true);
  });

  it('finishes once on a skip key, however many finish paths follow', async () => {
    const {onDone, player} = await mount();
    act(() => player.emit('playing'));
    press('select');
    press('enter');
    act(() => player.emit('ended'));
    act(() => {
      jest.advanceTimersByTime(SAFETY_MS + 1000);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('skips on key-up, not key-down, so the release cannot reach Home', async () => {
    const {onDone, player} = await mount();
    act(() => player.emit('playing'));
    key('select', 0);
    expect(onDone).not.toHaveBeenCalled();
    key('select', 1);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('finishes when the video ends', async () => {
    const {onDone, player} = await mount();
    act(() => player.emit('playing'));
    act(() => player.emit('ended'));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('plays the native fallback when the video errors before its first frame', async () => {
    const {screen, onDone, player} = await mount();
    act(() => player.emit('error'));
    expect(screen.getByTestId('intro-native')).toBeTruthy();
    expect(screen.queryByTestId('intro-video')).toBeNull();
    expect(onDone).not.toHaveBeenCalled();
    await flush();
    // The video player is released when the fallback takes over.
    expect(player.deinitialize).toHaveBeenCalledTimes(1);
    // A skip still finishes, once.
    press('select');
    press('select');
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('plays the native fallback when no frame arrives within the start timeout', async () => {
    const {screen, onDone} = await mount();
    act(() => {
      jest.advanceTimersByTime(START_TIMEOUT_MS + 10);
    });
    expect(screen.getByTestId('intro-native')).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('goes Home on an error after playback started', async () => {
    const {screen, onDone, player} = await mount();
    act(() => player.emit('playing'));
    act(() => player.emit('error'));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('intro-native')).toBeNull();
  });

  it('finishes at the safety timeout if the video never ends', async () => {
    const {onDone, player} = await mount();
    act(() => player.emit('playing'));
    act(() => {
      jest.advanceTimersByTime(SAFETY_MS - 100);
    });
    expect(onDone).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(200);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('finishes when the app goes to the background', async () => {
    const {onDone, player} = await mount();
    act(() => player.emit('playing'));
    const listen = useKeplerAppStateManager().addAppStateListener as jest.Mock;
    const handler = listen.mock.calls[listen.mock.calls.length - 1][1];
    act(() => handler('background'));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('releases the player on unmount and never calls onDone afterwards', async () => {
    const {screen, onDone, player} = await mount();
    act(() => player.emit('playing'));
    screen.unmount();
    await flush();
    expect(player.deinitialize).toHaveBeenCalledTimes(1);
    act(() => {
      jest.advanceTimersByTime(SAFETY_MS + 1000);
    });
    expect(onDone).not.toHaveBeenCalled();
  });
});
