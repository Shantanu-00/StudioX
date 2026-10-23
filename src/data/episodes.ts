import {ImageSourcePropType} from 'react-native';
import {cdnMediaUrl, companionMediaUrl} from '../config';
import {LinkMedia, MediaStatus} from '../services/inbox';

// The two demo episodes. Media is streamed as fragmented H.264/AAC MP4 through
// MSE (src/player/mseLoader.ts), never bundled: from CloudFront first, and
// from the local companion server if the CDN copy fails before the first
// frame. Posters are small pre-cut JPEGs with the hero scrim baked in, so the
// TV draws no runtime gradients.

export interface Episode {
  id: string;
  show: string;
  label: string;
  title: string;
  synopsis: string;
  people: string[];
  genre: string;
  durationSec: number;
  layers: string[];
  mediaUrl: string;
  fallbackMediaUrl?: string;
  // Demo episodes have pre-cut art; uploads have none (a typographic
  // placeholder is drawn instead).
  backdrop?: ImageSourcePropType;
  card?: ImageSourcePropType;
  // Where the co-viewer package lives, when it is not the CDN default.
  packageUrl?: string;
  // Set for a video uploaded from the linked phone: it has no bundled
  // analysis, and its package may not exist yet (see usePackage).
  upload?: {status: MediaStatus};
}

export interface DemoEpisode extends Episode {
  backdrop: ImageSourcePropType;
  card: ImageSourcePropType;
}

export const EPISODES: DemoEpisode[] = [
  {
    id: 'crime-case104',
    show: 'SHADOW FILES',
    label: 'CASE 104',
    title: 'The Pier 9 Disappearance',
    synopsis:
      'A sworn alibi, a cell-tower ping and cameras cut at the harbour. Follow the case as the timeline turns against the suspect.',
    people: ['Narrator'],
    genre: 'True crime',
    durationSec: 37,
    layers: ['TIMELINE', 'PEOPLE GRAPH', 'DOSSIER', 'SPOILER GATE'],
    mediaUrl: cdnMediaUrl('crime-case104'),
    fallbackMediaUrl: companionMediaUrl('crime-case104'),
    backdrop: require('../assets/episodes/crime-case104-backdrop.jpg'),
    card: require('../assets/episodes/crime-case104-card.jpg'),
  },
  {
    id: 'science-ep42',
    show: 'THE HUMAN BLUEPRINT',
    label: 'EP. 42',
    title: 'Elite Recovery Protocols',
    synopsis:
      'Dr. Julian and Elena on R90 sleep cycles, a two-compound evening stack, and why the bedroom should sit at 18 °C.',
    people: ['Elena (host)', 'Dr. Julian (guest)'],
    genre: 'Science · Health',
    durationSec: 37,
    layers: ['DOSSIER', 'CLAIM CHECK', 'COMPOUNDS', 'ROUTINE'],
    mediaUrl: cdnMediaUrl('science-ep42'),
    fallbackMediaUrl: companionMediaUrl('science-ep42'),
    backdrop: require('../assets/episodes/science-ep42-backdrop.jpg'),
    card: require('../assets/episodes/science-ep42-card.jpg'),
  },
];

export const episodeById = (id: string) => EPISODES.find((e) => e.id === id);

export const UPLOAD_SHOW = 'FROM YOUR PHONE';

// A Player episode for a phone upload (CONTRACTS.md §8): its own media URL,
// used as-is (no companion fallback), and its package URL when READY.
// Null when the upload cannot play yet.
export function uploadEpisode(m: LinkMedia): Episode | null {
  if (!m.playable || !m.mediaUrl) {
    return null;
  }
  return {
    id: m.mediaId,
    show: UPLOAD_SHOW,
    label: 'UPLOAD',
    title: m.title,
    synopsis: '',
    people: [],
    genre: 'Upload',
    // 0 when unknown: the player then takes it from the stream.
    durationSec: Math.round(m.durationSec ?? 0),
    layers: [],
    mediaUrl: m.mediaUrl,
    packageUrl: m.packageUrl,
    upload: {status: m.status},
  };
}
