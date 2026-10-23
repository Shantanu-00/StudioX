import {useCallback, useEffect, useRef, useState} from 'react';
import {APP_MODE} from '../config';
import {Answer, ExploreNode, Source} from '../analysis/schema';
import {Confirm} from '../hooks/useSystemToast';
import {askLive, Link, PhoneCard, shareCard} from '../services/api';
import {questionWithContext} from './mapData';

const LIVE = APP_MODE === 'live';

export interface MapAnswer {
  nodeId: string;
  question: string;
  status: 'loading' | 'ready';
  text: string;
  sources: Source[];
  live: boolean;
  note?: string;
}

// "Ask about this": the prepared answer at once in demo mode (or for a map
// with no video); in live mode POST /v1/ask with the node as context,
// falling back to the prepared answer. A newer question cancels an older
// one, and late replies are dropped.
export function useMapAsk(
  sessionId: string | null,
  mediaId: string,
  playhead: number | null,
) {
  const [answer, setAnswer] = useState<MapAnswer | null>(null);
  const request = useRef<AbortController | null>(null);
  const close = useCallback(() => {
    request.current?.abort();
    request.current = null;
    setAnswer(null);
  }, []);
  useEffect(() => () => request.current?.abort(), []);

  const ask = useCallback(
    (node: ExploreNode, question: string, prepared: Answer | null) => {
      request.current?.abort();
      request.current = null;
      const base: MapAnswer = {
        nodeId: node.id,
        question,
        status: 'ready',
        text: prepared?.text ?? '',
        sources: prepared?.sources ?? [],
        live: false,
      };
      if (!LIVE || !sessionId || playhead === null) {
        setAnswer(
          prepared
            ? base
            : {...base, text: 'There is no prepared answer for this question.'},
        );
        return;
      }
      const controller = new AbortController();
      request.current = controller;
      setAnswer({...base, status: 'loading', live: true});
      askLive(
        {
          sessionId,
          mediaId,
          t: playhead,
          question: questionWithContext(node, question),
        },
        controller.signal,
      )
        .then((r) => {
          if (request.current === controller) {
            setAnswer({...base, text: r.text, sources: r.sources, status: 'ready', live: true});
          }
        })
        .catch((e) => {
          if (request.current === controller) {
            console.warn(`[map] ask: ${(e as Error)?.message ?? String(e)}`);
            setAnswer({
              ...base,
              text: prepared?.text ?? 'The live co-viewer did not answer. Try again in a moment.',
              note: prepared
                ? 'The live co-viewer did not answer. This is the prepared answer.'
                : undefined,
            });
          }
        });
    },
    [sessionId, mediaId, playhead],
  );
  return {answer, ask, close};
}

export type SendStatus = 'idle' | 'sending' | 'sent' | 'failed';

// "Send to phone" for map pieces and sim plans (paired only): one request at
// a time per key, no duplicate sends, a Vega system toast on success.
export function useMapShare(
  link: Link | null,
  mediaId: string,
  t: number,
  confirm: Confirm | null,
) {
  const [status, setStatus] = useState<Record<string, SendStatus>>({});
  const statusRef = useRef(status);
  statusRef.current = status;
  const send = useCallback(
    (key: string, card: PhoneCard) => {
      const current = statusRef.current[key];
      if (!link || current === 'sending' || current === 'sent') {
        return;
      }
      setStatus((s) => ({...s, [key]: 'sending'}));
      shareCard(link.linkId, card, {mediaId, t})
        .then(() => {
          setStatus((s) => ({...s, [key]: 'sent'}));
          confirm?.('Sent to your phone', `${card.title} → ${link.phoneName}`);
        })
        .catch((e) => {
          console.warn(`[map] share: ${(e as Error)?.message ?? String(e)}`);
          setStatus((s) => ({...s, [key]: 'failed'}));
        });
    },
    [link, mediaId, t, confirm],
  );
  const statusOf = useCallback((key: string) => status[key] ?? 'idle', [status]);
  return {paired: !!link, phoneName: link?.phoneName ?? '', send, statusOf};
}

export type MapShare = ReturnType<typeof useMapShare>;

export const sendLabel = (s: SendStatus) =>
  s === 'sending'
    ? 'Sending…'
    : s === 'sent'
    ? 'Sent to your phone'
    : s === 'failed'
    ? 'Try sending again'
    : 'Send to phone';
