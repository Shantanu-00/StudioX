// Gaps in the @amazon-devices/react-native-kepler Jest preset (4.0.1):
// - its BackHandler mock has no `default`, so `BackHandler` is undefined;
// - KeplerAppStateManager has no mock and calls a missing native method.
// Paths are relative on purpose: the package "exports" map would resolve to
// the generic .js file instead of the .kepler.js one the runtime loads.

jest.mock(
  '../node_modules/@amazon-devices/react-native-kepler/Libraries/Utilities/BackHandler',
  () => ({
    __esModule: true,
    default: {
      addEventListener: jest.fn(() => ({remove: jest.fn()})),
      exitApp: jest.fn(),
    },
  }),
);

jest.mock(
  '../node_modules/@amazon-devices/react-native-kepler/Libraries/KeplerAppState/KeplerAppStateManager',
  () => {
    const manager = {
      getCurrentState: () => 'active',
      addAppStateListener: jest.fn(() => ({remove: jest.fn()})),
      addEventListener: jest.fn(() => ({remove: jest.fn()})),
      addEventListenerWithReplay: jest.fn(() => ({remove: jest.fn()})),
      getComponentInstance: jest.fn(),
    };
    return {useKeplerAppStateManager: () => manager};
  },
);

// Native media and UI packages have no Jest implementation; replace them with
// inert stand-ins so screens can render. Playback itself is verified on Vega.
jest.mock('@amazon-devices/react-native-reanimated', () =>
  require('@amazon-devices/react-native-reanimated/mock'),
);

jest.mock('@amazon-devices/react-native-w3cmedia', () => {
  const React = require('react');
  const {View} = require('react-native');
  // Instances and listeners are recorded so screen tests can drive events
  // (`VideoPlayer.instances`, `player.emit('playing')`).
  class VideoPlayer {
    static instances: VideoPlayer[] = [];
    listeners = new Map<string, Set<() => void>>();
    constructor() {
      VideoPlayer.instances.push(this);
    }
    emit(type: string) {
      this.listeners.get(type)?.forEach((fn) => fn());
    }
    src = '';
    muted = false;
    autoplay = false;
    currentTime = 0;
    duration = 37;
    paused = true;
    error = null;
    setMediaControlFocus = jest.fn(async () => {});
    initialize = jest.fn(async () => {});
    deinitialize = jest.fn(async () => {});
    addEventListener = jest.fn((type: string, fn: () => void) => {
      const set = this.listeners.get(type) ?? new Set<() => void>();
      set.add(fn);
      this.listeners.set(type, set);
    });
    removeEventListener = jest.fn((type: string, fn: () => void) => {
      this.listeners.get(type)?.delete(fn);
    });
    setSurfaceHandle = jest.fn();
    clearSurfaceHandle = jest.fn();
    play = jest.fn(async () => {});
    pause = jest.fn();
    removeAttribute = jest.fn();
    load = jest.fn();
  }
  return {
    VideoPlayer,
    KeplerVideoSurfaceView: (props: object) => React.createElement(View, props),
  };
});

jest.mock('@amazon-devices/kepler-ui-components', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    SeekBar: React.forwardRef((props: object, ref: unknown) => {
      React.useImperativeHandle(ref, () => ({
        requestTVFocus: jest.fn(),
        resetThumbValue: jest.fn(),
      }));
      return React.createElement(View, {...props, testID: 'seekbar'});
    }),
    ProgressBar: (props: object) => React.createElement(View, props),
  };
});

// AsyncStorage (built into react-native-kepler) has no Jest implementation:
// an in-memory stand-in, cleared with `__reset()`.
jest.mock(
  '../node_modules/@amazon-devices/react-native-kepler/Libraries/Storage/AsyncStorage',
  () => {
    const data = new Map<string, string>();
    return {
      getItem: jest.fn(async (k: string) => data.get(k) ?? null),
      setItem: jest.fn(async (k: string, v: string) => {
        data.set(k, v);
      }),
      removeItem: jest.fn(async (k: string) => {
        data.delete(k);
      }),
      __reset: () => data.clear(),
    };
  },
);

// No test may reach the network: fetch fails unless a test mocks it.
globalThis.fetch = jest.fn(() =>
  Promise.reject(new Error('network disabled in tests')),
) as unknown as typeof fetch;

// The preset's Dimensions mock returns no subscription from
// addEventListener, so useWindowDimensions throws on unmount.
{
  const {Dimensions} = require('react-native');
  const add = Dimensions.addEventListener;
  Dimensions.addEventListener = (...args: unknown[]) =>
    add?.apply(Dimensions, args) ?? {remove: () => {}};
}
