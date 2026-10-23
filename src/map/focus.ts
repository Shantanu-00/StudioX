import {useEffect, useRef} from 'react';
import {View} from 'react-native';
import {FocusManager} from '@amazon-devices/react-native-kepler';

// FocusManager.focus may fail when called during the first mount (Vega focus
// docs, "known timing issue"), so it runs on the next tick, and once more a
// little later: an element that has just become focusable again (when a
// sheet closes) is not always focusable natively in the same frame (VVD).
export function focusSoon(
  target: View | null | undefined,
  delays: number[] = [0, 150],
) {
  if (!target) {
    return;
  }
  delays.forEach((ms) =>
    setTimeout(() => {
      try {
        FocusManager.focus(
          target as unknown as Parameters<typeof FocusManager.focus>[0],
        );
      } catch (e) {
        console.warn('[map] focus failed', e);
      }
    }, ms),
  );
}

// `hasTVPreferredFocus` only applies on first mount and does not pull focus
// off a trapped component; the preferred element also asks FocusManager.
export function useFocusOnMount<T extends View>(enabled: boolean) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (enabled) {
      focusSoon(ref.current);
    }
  }, [enabled]);
  return ref;
}
