import {bundledIds, localPackage} from '../analysis/packageLoader';
import {EpisodeAnalysis} from '../analysis/schema';
import {CameoMap, CATEGORY_WORD} from './mapData';

// Cameo maps: bundled packages marked `example: true`, with a title and a
// valid map and no video (they show the Map on other kinds of conversation).
// Read once per call from the validated bundled packages; there are at most
// a handful.
export function cameoMaps(): CameoMap[] {
  const out: CameoMap[] = [];
  for (const id of bundledIds()) {
    const pkg = localPackage(id);
    const a = pkg?.source === 'bundled' ? pkg.analysis : null;
    if (a?.example && a.explore) {
      out.push({
        mediaId: id,
        title: a.title ?? a.explore.title,
        category: CATEGORY_WORD[a.explore.category],
        explore: a.explore,
      });
    }
  }
  return out.slice(0, 6);
}

export function cameoPackage(mediaId: string): EpisodeAnalysis | null {
  const pkg = localPackage(mediaId);
  return pkg?.source === 'bundled' && pkg.analysis.example && pkg.analysis.explore
    ? pkg.analysis
    : null;
}
