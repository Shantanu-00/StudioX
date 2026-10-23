import {useCallback, useEffect, useRef, useState} from 'react';
import {useKeplerAppStateManager} from '@amazon-devices/react-native-kepler';
import {PAIRING_POLL_MS} from '../config';
import {createPairing, getPairing, linkStore, Pairing} from '../services/api';

export type LinkPairingState =
  | {phase: 'creating'}
  | {
      phase: 'live';
      pairing: Pairing;
      status: 'waiting' | 'linked' | 'expired';
      phoneName?: string;
    }
  | {phase: 'error'; message: string};

const MAX_BACKOFF_MS = 8000;
const MAX_FAILURES = 5;

// Pairs a phone through the AWS API: POST /v1/pairings, then polls
// GET /v1/pairings/{code} until linked or expired. Polling stops in the
// background and on unmount; responses from an older code (after "Get a new
// code") are dropped. On `linked` the link is stored for the whole app.
export function useLinkPairing() {
  const [state, setState] = useState<LinkPairingState>({phase: 'creating'});
  const [generation, setGeneration] = useState(0);
  const [foreground, setForeground] = useState(true);
  const appState = useKeplerAppStateManager();
  const pairingRef = useRef<Pairing | null>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    const sub = appState.addAppStateListener('change', (next) =>
      setForeground(next === 'active'),
    );
    return () => sub.remove();
  }, [appState]);

  useEffect(() => {
    const controller = new AbortController();
    pairingRef.current = null;
    doneRef.current = false;
    setState({phase: 'creating'});
    createPairing(controller.signal)
      .then((pairing) => {
        if (controller.signal.aborted) {
          return;
        }
        pairingRef.current = pairing;
        setState({phase: 'live', pairing, status: 'waiting'});
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) {
          setState({phase: 'error', message: e.message});
        }
      });
    return () => controller.abort();
  }, [generation]);

  const live = state.phase === 'live';

  useEffect(() => {
    const pairing = pairingRef.current;
    if (!live || !foreground || !pairing || doneRef.current) {
      return;
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;

    const finish = (status: 'linked' | 'expired', phoneName?: string) => {
      doneRef.current = true;
      setState({phase: 'live', pairing, status, phoneName});
    };

    const tick = async () => {
      if (Date.now() >= pairing.expiresAt) {
        finish('expired');
        return;
      }
      try {
        const s = await getPairing(pairing.code, controller.signal);
        if (controller.signal.aborted || pairingRef.current !== pairing) {
          return;
        }
        failures = 0;
        if (s.status === 'linked') {
          await linkStore.set({linkId: s.linkId, phoneName: s.phoneName});
          finish('linked', s.phoneName);
          return;
        }
        if (s.status === 'expired') {
          finish('expired');
          return;
        }
      } catch (e) {
        if (controller.signal.aborted) {
          return;
        }
        failures += 1;
        if (failures >= MAX_FAILURES) {
          setState({phase: 'error', message: (e as Error).message});
          return;
        }
      }
      const delay = Math.min(PAIRING_POLL_MS * 2 ** failures, MAX_BACKOFF_MS);
      timer = setTimeout(tick, delay);
    };

    tick();
    return () => {
      controller.abort();
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [live, foreground]);

  const retry = useCallback(() => setGeneration((g) => g + 1), []);
  return {state, retry};
}
