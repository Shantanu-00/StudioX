import {useCallback, useEffect, useRef, useState} from 'react';
import {APP_MODE, NOW_PLAYING_MS} from '../config';
import {Answer, Widget} from '../analysis/schema';
import {
  askLive,
  createSession,
  Link,
  putNowPlaying,
  refineCard,
  shareCard,
} from '../services/api';
import {toPhoneCard} from '../services/phoneCards';
import {Confirm} from '../hooks/useSystemToast';
import {ShareContext, ShareStatus} from '../widgets/parts';
import {AnswerState} from './CoViewPanel';
import {PlaybackStore} from './playbackStore';

// The networked half of the co-viewer. Nothing here ever blocks the remote:
// every call is fire-and-forget into state, with a timeout, and late replies
// for an older moment or session are dropped.

const LIVE = APP_MODE === 'live';

const warn = (what: string, e: unknown) =>
  console.warn(`[coviewer] ${what}: ${(e as Error)?.message ?? String(e)}`);

// POST /v1/sessions once per episode (live mode only).
export function useLiveSession(mediaId: string): string | null {
  const [sessionId, setSessionId] = useState<string | null>(null);
  useEffect(() => {
    if (!LIVE) {
      return;
    }
    setSessionId(null);
    const controller = new AbortController();
    createSession(mediaId, controller.signal)
      .then((id) => !controller.signal.aborted && setSessionId(id))
      .catch((e) => !controller.signal.aborted && warn('session', e));
    return () => controller.abort();
  }, [mediaId]);
  return sessionId;
}

export interface Refined {
  sessionId: string;
  t: number;
  caption?: string;
  widget?: Widget;
}

// On pause, after the instant local card: POST /v1/refine for that moment.
// The reply is kept only for the (session, t) it was asked for.
export function useRefine(
  sessionId: string | null,
  mediaId: string,
  t: number,
  active: boolean,
): Refined | null {
  const [refined, setRefined] = useState<Refined | null>(null);
  useEffect(() => {
    if (!LIVE || !sessionId || !active) {
      return;
    }
    const controller = new AbortController();
    refineCard({sessionId, mediaId, t}, controller.signal)
      .then((r) => {
        if (r && !controller.signal.aborted) {
          setRefined({sessionId, t, ...r});
        }
      })
      .catch((e) => !controller.signal.aborted && warn('refine', e));
    return () => controller.abort();
  }, [sessionId, mediaId, t, active]);
  return refined && refined.sessionId === sessionId && refined.t === t
    ? refined
    : null;
}

// Opens an answer: the prepared text at once in demo mode; in live mode a
// POST /v1/ask, falling back to the prepared text if it fails.
export function useAsk(sessionId: string | null, mediaId: string) {
  const [answer, setAnswer] = useState<AnswerState | null>(null);
  const request = useRef<AbortController | null>(null);

  const close = useCallback(() => {
    request.current?.abort();
    request.current = null;
    setAnswer(null);
  }, []);
  useEffect(() => () => request.current?.abort(), []);

  const ask = useCallback(
    (a: Answer, t: number) => {
      request.current?.abort();
      request.current = null;
      const prepared: AnswerState = {
        question: a.question,
        t,
        status: 'ready',
        text: a.text,
        cites: a.cites,
        sources: a.sources,
        live: false,
      };
      if (!LIVE || !sessionId) {
        setAnswer(prepared);
        return;
      }
      const controller = new AbortController();
      request.current = controller;
      setAnswer({...prepared, status: 'loading', live: true});
      askLive({sessionId, mediaId, t, question: a.question}, controller.signal)
        .then((r) => {
          if (request.current === controller) {
            setAnswer({...prepared, ...r, status: 'ready', live: true});
          }
        })
        .catch((e) => {
          if (request.current === controller) {
            warn('ask', e);
            setAnswer({
              ...prepared,
              note: 'The live co-viewer did not answer. This is the prepared answer.',
            });
          }
        });
    },
    [sessionId, mediaId],
  );

  return {answer, ask, close};
}

// PUT /v1/links/{linkId}/now every 5 s while playing, and once on every
// play/pause change. Only when a phone is paired.
export function useNowPlaying(
  store: PlaybackStore,
  link: Link | null,
  mediaId: string,
  title: string,
) {
  const linkId = link?.linkId;
  useEffect(() => {
    if (!linkId) {
      return;
    }
    let failures = 0;
    const send = (playing: boolean) => {
      const t = Math.round(store.get().t * 10) / 10;
      putNowPlaying(linkId, {mediaId, title, t, playing})
        .then(() => {
          failures = 0;
        })
        .catch((e) => {
          // Log the first failure of a run, not one every five seconds.
          if (failures++ === 0) {
            warn('now playing', e);
          }
        });
    };
    let paused = store.get().paused;
    const unsubscribe = store.subscribe(() => {
      const next = store.get().paused;
      if (next !== paused) {
        paused = next;
        send(!next);
      }
    });
    const timer = setInterval(() => {
      if (!store.get().paused) {
        send(true);
      }
    }, NOW_PLAYING_MS);
    return () => {
      unsubscribe();
      clearInterval(timer);
      send(false); // leaving the player: the phone stops showing it live
    };
  }, [store, linkId, mediaId, title]);
}

// "Send to phone" for protocol and entity_list cards (paired only).
export function useShare(
  link: Link | null,
  mediaId: string,
  store: PlaybackStore,
  widgets: Widget[],
  confirm: Confirm | null,
): ShareContext | undefined {
  const [status, setStatus] = useState<Record<string, ShareStatus>>({});
  const statusRef = useRef(status);
  statusRef.current = status;
  const widgetsRef = useRef(widgets);
  widgetsRef.current = widgets;

  const send = useCallback(
    (widgetId: string) => {
      const w = widgetsRef.current.find((x) => x.id === widgetId);
      const card = w ? toPhoneCard(w) : null;
      const current = statusRef.current[widgetId];
      if (!link || !card || current === 'sending' || current === 'sent') {
        return; // no duplicate sends
      }
      setStatus((s) => ({...s, [widgetId]: 'sending'}));
      shareCard(link.linkId, card, {mediaId, t: store.get().t})
        .then(() => {
          setStatus((s) => ({...s, [widgetId]: 'sent'}));
          confirm?.('Sent to your phone', `${card.title} → ${link.phoneName}`);
        })
        .catch((e) => {
          warn('share', e);
          setStatus((s) => ({...s, [widgetId]: 'failed'}));
        });
    },
    [link, mediaId, store, confirm],
  );

  if (!link) {
    return undefined;
  }
  return {
    phoneName: link.phoneName,
    status: (id) => status[id] ?? 'idle',
    send,
  };
}
