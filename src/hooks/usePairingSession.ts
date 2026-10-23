import {useCallback, useEffect, useRef, useState} from 'react';
import {useKeplerAppStateManager} from '@amazon-devices/react-native-kepler';
import {PAIRING_POLL_MS} from '../config';
import {
  createSession,
  fetchSnapshot,
  isTerminal,
  PairingSession,
  SessionKind,
  SessionSnapshot,
} from '../services/companion';

export type PairingState =
  | {phase: 'creating'}
  | {phase: 'live'; session: PairingSession; snapshot: SessionSnapshot}
  | {phase: 'error'; message: string};

const MAX_BACKOFF_MS = 8000;
const MAX_FAILURES = 5;

// Creates one temporary pairing session and polls it until it reaches a
// terminal state. Polling stops in the background and on unmount; responses
// from an older generation (after retry) are dropped.
export function usePairingSession(kind: SessionKind) {
  const [state, setState] = useState<PairingState>({phase: 'creating'});
  const [generation, setGeneration] = useState(0);
  const appState = useKeplerAppStateManager();
  const [foreground, setForeground] = useState(true);

  const sessionRef = useRef<PairingSession | null>(null);
  const terminalRef = useRef(false);

  useEffect(() => {
    const sub = appState.addAppStateListener('change', (next) => {
      setForeground(next === 'active');
    });
    return () => sub.remove();
  }, [appState]);

  // Create the session for this generation.
  useEffect(() => {
    const controller = new AbortController();
    sessionRef.current = null;
    terminalRef.current = false;
    setState({phase: 'creating'});
    createSession(kind, controller.signal)
      .then((session) => {
        if (controller.signal.aborted) {
          return;
        }
        sessionRef.current = session;
        setState({
          phase: 'live',
          session,
          snapshot: {status: 'waiting', expiresAt: session.expiresAt},
        });
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) {
          setState({phase: 'error', message: e.message});
        }
      });
    return () => controller.abort();
  }, [kind, generation]);

  const live = state.phase === 'live';

  // Poll while live, in the foreground and not yet terminal.
  useEffect(() => {
    const session = sessionRef.current;
    if (!live || !foreground || !session || terminalRef.current) {
      return;
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;

    const tick = async () => {
      if (Date.now() >= session.expiresAt) {
        terminalRef.current = true;
        setState({
          phase: 'live',
          session,
          snapshot: {status: 'expired', expiresAt: session.expiresAt},
        });
        return;
      }
      try {
        const snapshot = await fetchSnapshot(session, controller.signal);
        if (controller.signal.aborted || sessionRef.current !== session) {
          return;
        }
        failures = 0;
        setState((prev) =>
          prev.phase === 'live' && sameSnapshot(prev.snapshot, snapshot)
            ? prev
            : {phase: 'live', session, snapshot},
        );
        if (isTerminal(snapshot.status)) {
          terminalRef.current = true;
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

function sameSnapshot(a: SessionSnapshot, b: SessionSnapshot) {
  return (
    a.status === b.status &&
    a.device === b.device &&
    a.error === b.error &&
    a.upload?.bytes === b.upload?.bytes &&
    a.upload?.total === b.upload?.total &&
    a.upload?.name === b.upload?.name
  );
}
