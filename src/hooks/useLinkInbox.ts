import {useEffect, useState} from 'react';
import {useKeplerAppStateManager} from '@amazon-devices/react-native-kepler';
import {INBOX_POLL_MS} from '../config';
import {listLinkMedia, listMessages} from '../services/api';
import {LinkMedia, mergeMessages, Message} from '../services/inbox';

export interface InboxState {
  messages: Message[]; // oldest → newest, at most MAX_MESSAGES
  media: LinkMedia[]; // newest first, at most MAX_MEDIA
  thread: 'loading' | 'ok' | 'error';
  uploads: 'loading' | 'ok' | 'unavailable';
}

const MAX_BACKOFF_MS = 32000;

const EMPTY: InboxState = {
  messages: [],
  media: [],
  thread: 'loading',
  uploads: 'loading',
};

// Module scope, bounded (≤ 50 messages, ≤ 20 uploads): coming back from the
// Player draws the inbox at once, so focus can be restored to the upload
// that was played, and polling resumes from the cursor instead of from zero.
let cache: {linkId: string; state: InboxState; cursor?: string} | null = null;

const fromCache = (linkId: string | null): InboxState =>
  linkId && cache?.linkId === linkId ? cache.state : EMPTY;

const warn = (what: string, e: unknown) =>
  console.warn(`[inbox] ${what}: ${(e as Error)?.message ?? String(e)}`);

// The TV inbox for a paired phone: GET /v1/links/{id}/messages (after the
// last cursor) and GET /v1/links/{id}/media, every 4 s. It polls only while
// mounted (the section is visible) and the app is in the foreground; each
// cycle starts after the previous one finished, so requests never pile up.
// Failed thread polls back off up to 32 s. Late replies after unmount, a
// link change or backgrounding are dropped.
export function useLinkInbox(linkId: string | null): InboxState {
  const [state, setState] = useState<InboxState>(() => fromCache(linkId));
  const [foreground, setForeground] = useState(true);
  const appState = useKeplerAppStateManager();

  useEffect(() => {
    const sub = appState.addAppStateListener('change', (next) =>
      setForeground(next === 'active'),
    );
    return () => sub.remove();
  }, [appState]);

  useEffect(() => {
    setState(fromCache(linkId));
  }, [linkId]);

  useEffect(() => {
    if (!linkId || !foreground) {
      return;
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let mediaWarned = false;

    const tick = async () => {
      const held = cache?.linkId === linkId ? cache : null;
      const [thread, media] = await Promise.allSettled([
        listMessages(linkId, held?.cursor, controller.signal),
        listLinkMedia(linkId, controller.signal),
      ]);
      if (controller.signal.aborted) {
        return;
      }
      const prev = held?.state ?? EMPTY;
      const next: InboxState = {...prev};
      let cursor = held?.cursor;
      if (thread.status === 'fulfilled') {
        failures = 0;
        next.messages = mergeMessages(prev.messages, thread.value.messages);
        next.thread = 'ok';
        cursor = thread.value.cursor;
      } else {
        if (failures++ === 0) {
          warn('thread', thread.reason);
        }
        next.thread = prev.thread === 'ok' ? 'ok' : 'error';
      }
      if (media.status === 'fulfilled') {
        mediaWarned = false;
        // Same list as before: keep the old array so nothing re-renders.
        next.media =
          JSON.stringify(media.value) === JSON.stringify(prev.media)
            ? prev.media
            : media.value;
        next.uploads = 'ok';
      } else {
        if (!mediaWarned) {
          mediaWarned = true;
          warn('media', media.reason);
        }
        // Keep the last list if there was one; otherwise say so.
        next.uploads = prev.uploads === 'ok' ? 'ok' : 'unavailable';
      }
      const changed = (Object.keys(next) as Array<keyof InboxState>).some(
        (k) => next[k] !== prev[k],
      );
      cache = {linkId, state: changed ? next : prev, cursor};
      if (changed) {
        setState(next);
      }
      const delay =
        failures > 0
          ? Math.min(INBOX_POLL_MS * 2 ** failures, MAX_BACKOFF_MS)
          : INBOX_POLL_MS;
      timer = setTimeout(tick, delay);
    };

    tick();
    return () => {
      controller.abort();
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [linkId, foreground]);

  return linkId ? state : EMPTY;
}

// For tests.
export function resetInboxCache() {
  cache = null;
}
