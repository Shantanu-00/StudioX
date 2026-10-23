import 'react-native';
import {act, renderHook} from '@testing-library/react-native';

import {localPackage} from '../../src/analysis/packageLoader';
import {createPlaybackStore} from '../../src/player/playbackStore';
import {useInsightBanner} from '../../src/screens/Player';

const science = localPackage('science-ep42')!.analysis;

describe('insight banner', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('appears when playback enters a questionable claim, for 5 s, once a minute', () => {
    const store = createPlaybackStore({t: 0, paused: false});
    const {result, rerender} = renderHook(
      ({enabled}: {enabled: boolean}) =>
        useInsightBanner(store, science, enabled),
      {initialProps: {enabled: true}},
    );
    expect(result.current).toBeNull();

    // Into the first NUANCED claim's evidence window.
    act(() => store.set({t: 7}));
    expect(result.current?.id).toBe('claims-s1-1');

    act(() => jest.advanceTimersByTime(5000));
    expect(result.current).toBeNull();

    // The next claim arrives within the same minute: no banner.
    act(() => store.set({t: 14}));
    expect(result.current).toBeNull();

    // Opening the panel or pausing hides it at once.
    act(() => store.set({t: 0}));
    rerender({enabled: false});
    expect(result.current).toBeNull();
  });
});
