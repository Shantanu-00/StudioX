import {useEffect, useRef, useState} from 'react';
import {useKeplerAppStateManager} from '@amazon-devices/react-native-kepler';
import {
  PACKAGE_POLL_MS,
  PACKAGE_TIMEOUT_MS,
  PACKAGE_WAIT_MS,
  packageUrl,
} from '../config';
import {ANALYSES} from './fixtures';
import {EpisodeAnalysis, validatePackage} from './schema';

// Where the co-viewer's analysis for an episode comes from, best first:
// 1. `cdn`: the pipeline's package, https://<cf>/packages/<id>/latest.json;
// 2. `bundled`: a package file shipped in the app (src/analysis/packages,
//    written by backend/scripts/seed_demo.py, with a generated index.ts);
// 3. `fixture`: the hand-written demo analysis in fixtures.ts.
// Every source passes `validatePackage`; the panel footer says which one is
// on screen.
// Uploads from the phone have no local package. Until theirs is published
// the source is `pending` (an empty analysis, stated as "Analysing…"); if it
// never arrives, or the pipeline ended without one, it is `none`.
export type PackageSource = 'cdn' | 'bundled' | 'fixture' | 'pending' | 'none';

export interface LoadedPackage {
  analysis: EpisodeAnalysis;
  source: PackageSource;
}

// The bundled index is optional: it exists only once the pipeline output has
// been seeded. Metro treats a require inside try/catch as an optional
// dependency, so a build without the folder still bundles.
let bundled: Record<string, unknown> = {};
try {
  const index = require('./packages');
  if (index && typeof index.BUNDLED === 'object' && index.BUNDLED) {
    bundled = index.BUNDLED;
  }
} catch {
  // Not seeded yet: fixtures are the local fallback.
}

// The media ids of every bundled package (demo episodes and cameo maps).
export const bundledIds = () => Object.keys(bundled);

// For tests: replace the bundled index.
export function setBundledPackages(next: Record<string, unknown>) {
  bundled = next;
}

// Packages may omit the transcript; the demo clips need it for captions, so
// borrow the fixture's (it is the same episode script).
const withTranscript = (a: EpisodeAnalysis): EpisodeAnalysis =>
  a.transcript.length > 0
    ? a
    : {...a, transcript: ANALYSES[a.mediaId]?.transcript ?? []};

export function localPackage(mediaId: string): LoadedPackage | null {
  const pkg = validatePackage(bundled[mediaId], mediaId);
  if (pkg) {
    return {analysis: withTranscript(pkg), source: 'bundled'};
  }
  const fixture = ANALYSES[mediaId];
  return fixture ? {analysis: fixture, source: 'fixture'} : null;
}

type Signal = AbortController['signal'];

// Fetches and validates the CDN package. Resolves null on any failure
// (timeout, HTTP error, malformed JSON, wrong episode): the caller keeps the
// local package.
export async function fetchPackage(
  mediaId: string,
  signal?: Signal,
  url: string = packageUrl(mediaId),
): Promise<EpisodeAnalysis | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PACKAGE_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const res = await fetch(url, {
      headers: {Accept: 'application/json'},
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(`[package] ${mediaId}: HTTP ${res.status}, using local`);
      return null;
    }
    const pkg = validatePackage(await res.json(), mediaId);
    if (!pkg) {
      console.warn(`[package] ${mediaId}: failed validation, using local`);
      return null;
    }
    return withTranscript(pkg);
  } catch (e) {
    if (!signal?.aborted) {
      console.warn(
        `[package] ${mediaId}: ${
          controller.signal.aborted ? 'timed out' : String(e)
        }, using local`,
      );
    }
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

const EMPTY = (
  mediaId: string,
  source: PackageSource = 'fixture',
): LoadedPackage => ({
  source,
  analysis: {
    mediaId,
    provenance: 'demo-fixture',
    transcript: [],
    segments: [],
    moments: [],
    widgets: [],
    answers: [],
  },
});

export interface RemotePackage {
  // The package URL; the CDN default (packages/<id>/latest.json) if absent.
  url?: string;
  // False when the pipeline has ended without a package (NOT_A_FIT, FAILED):
  // nothing to wait for.
  expected: boolean;
}

const initial = (mediaId: string, remote?: RemotePackage): LoadedPackage =>
  remote
    ? EMPTY(mediaId, remote.expected ? 'pending' : 'none')
    : localPackage(mediaId) ?? EMPTY(mediaId);

// Demo episodes: the local package at once (so the panel works offline from
// the first frame), replaced by the CDN package if a valid one arrives.
//
// Uploads (`remote`): no bundled fallback. The package is fetched now and
// then every 10 s while it does not exist yet, until it arrives or 10 minutes
// have passed (then `none`). Polling pauses while the app is in the
// background; the 10 minutes count from the first attempt.
export function usePackage(
  mediaId: string,
  remote?: RemotePackage,
): LoadedPackage {
  const [pkg, setPkg] = useState<LoadedPackage>(() => initial(mediaId, remote));
  const [foreground, setForeground] = useState(true);
  const appState = useKeplerAppStateManager();
  const isRemote = !!remote;
  const remoteUrl = remote?.url;
  const expected = remote?.expected ?? false;

  useEffect(() => {
    if (!isRemote) {
      return;
    }
    const sub = appState.addAppStateListener('change', (next) =>
      setForeground(next === 'active'),
    );
    return () => sub.remove();
  }, [appState, isRemote]);

  // Upload path. Refs carry, per media id, when waiting stops and whether it
  // has finished, so a background trip resumes the same wait.
  const finished = useRef<string | null>(null);
  const deadline = useRef<{id: string; at: number} | null>(null);
  useEffect(() => {
    if (!isRemote) {
      return;
    }
    if (!expected) {
      finished.current = mediaId;
      setPkg((prev) =>
        prev.analysis.mediaId === mediaId && prev.source === 'none'
          ? prev
          : EMPTY(mediaId, 'none'),
      );
      return;
    }
    if (finished.current === mediaId || !foreground) {
      return;
    }
    if (deadline.current?.id !== mediaId) {
      deadline.current = {id: mediaId, at: Date.now() + PACKAGE_WAIT_MS};
      setPkg((prev) =>
        prev.analysis.mediaId === mediaId && prev.source === 'pending'
          ? prev
          : EMPTY(mediaId, 'pending'),
      );
    }
    const until = deadline.current.at;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = () => {
      fetchPackage(mediaId, controller.signal, remoteUrl).then((analysis) => {
        if (controller.signal.aborted) {
          return;
        }
        if (analysis) {
          finished.current = mediaId;
          setPkg({analysis, source: 'cdn'});
        } else if (Date.now() >= until) {
          finished.current = mediaId;
          console.warn(`[package] ${mediaId}: no package after 10 min`);
          setPkg(EMPTY(mediaId, 'none'));
        } else {
          timer = setTimeout(attempt, PACKAGE_POLL_MS);
        }
      });
    };
    attempt();
    return () => {
      controller.abort();
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [isRemote, mediaId, remoteUrl, expected, foreground]);

  // Demo path.
  useEffect(() => {
    if (isRemote) {
      return;
    }
    setPkg((prev) =>
      prev.analysis.mediaId === mediaId
        ? prev
        : localPackage(mediaId) ?? EMPTY(mediaId),
    );
    const controller = new AbortController();
    fetchPackage(mediaId, controller.signal).then((analysis) => {
      if (!analysis || controller.signal.aborted) {
        return;
      }
      // The newest analysis wins: a CDN copy older than the bundled one
      // (re-seeding lags a local pipeline run) does not replace it.
      const local = localPackage(mediaId);
      if (local && isOlder(analysis, local.analysis)) {
        console.warn(`[package] ${mediaId}: CDN copy is older, keeping bundled`);
        return;
      }
      setPkg({analysis, source: 'cdn'});
    });
    return () => controller.abort();
  }, [mediaId, isRemote]);
  return pkg;
}

// True when `a` was generated before `b` (both dated).
export function isOlder(a: EpisodeAnalysis, b: EpisodeAnalysis): boolean {
  const ta = a.generatedAt ? Date.parse(a.generatedAt) : NaN;
  const tb = b.generatedAt ? Date.parse(b.generatedAt) : NaN;
  return Number.isFinite(ta) && Number.isFinite(tb) && ta < tb;
}

// The panel footer: provenance stated plainly, in one short line.
export function provenanceLine(analysis: EpisodeAnalysis): string {
  if (analysis.provenance !== 'pipeline') {
    return 'Demo analysis from the episode script';
  }
  const at = analysis.generatedAt ? new Date(analysis.generatedAt) : null;
  const date =
    at && Number.isFinite(at.getTime())
      ? `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]}`
      : null;
  return date ? `Analysed by StudioX · ${date}` : 'Analysed by StudioX';
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
