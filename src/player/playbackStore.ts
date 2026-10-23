import {useSyncExternalStore} from 'react';

// Playback state lives outside React so `timeupdate` (several times a second)
// only re-renders the few components that subscribe, never the whole player.

export interface PlaybackState {
  t: number;
  duration: number;
  paused: boolean;
  buffering: boolean;
}

export function createPlaybackStore(initial: Partial<PlaybackState> = {}) {
  let state: PlaybackState = {
    t: 0,
    duration: 0,
    paused: true,
    buffering: true,
    ...initial,
  };
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(patch: Partial<PlaybackState>) {
      const next = {...state, ...patch};
      if (
        next.t === state.t &&
        next.duration === state.duration &&
        next.paused === state.paused &&
        next.buffering === state.buffering
      ) {
        return;
      }
      state = next;
      listeners.forEach((l) => l());
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
  };
}

export type PlaybackStore = ReturnType<typeof createPlaybackStore>;

// Subscribe to one derived value; the component re-renders only when the
// selected value changes (e.g. whole seconds for a clock).
export function usePlayback<T>(
  store: PlaybackStore,
  select: (s: PlaybackState) => T,
): T {
  return useSyncExternalStore(store.subscribe, () => select(store.get()));
}
