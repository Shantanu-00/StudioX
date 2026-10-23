import {uniqueSources} from '../analysis/cardText';
import {
  Answer,
  Explore,
  ExploreCategory,
  ExploreNode,
  Source,
  Widget,
} from '../analysis/schema';
import {formatTime} from '../analysis/composer';
import {PhoneCard} from '../services/api';
import {clock, hoursAndMinutes, nextOccurrence, NightPlan} from './sims';
import {LOOKAHEAD_S} from './layout';

// The words and cards the Map derives from its data. Pure, so tested.

export const CATEGORY_WORD: Record<ExploreCategory, string> = {
  health: 'Health',
  crime: 'Crime',
  finance: 'Money',
  history: 'History',
  tech: 'Technology',
  motivation: 'Motivation',
  scifi: 'Science fiction',
  other: 'Ideas',
};

const KIND_WORD: Record<ExploreNode['kind'], string> = {
  idea: 'Idea',
  step: 'Step',
  claim: 'Claim',
  event: 'Event',
  person: 'Person',
  number: 'Number',
};

// The small line above a node's label: its `when`, else when it was said.
export function nodeMeta(node: ExploreNode, withTime: boolean): string {
  if (node.when) {
    return node.when;
  }
  if (withTime && node.t !== null) {
    return `${KIND_WORD[node.kind]} · ${formatTime(node.t)}`;
  }
  return KIND_WORD[node.kind];
}

// "1,200 %", "37%", "$5,000": a compare value as one short string.
export function valueText(v: {n: number; unit: string}): string {
  const n = Math.abs(v.n) >= 1000 ? Math.round(v.n) : Math.round(v.n * 100) / 100;
  const digits = String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const unit = v.unit.trim();
  if (!unit) {
    return digits;
  }
  if (/^[$£€₹¥]$/.test(unit)) {
    return `${unit}${digits}`;
  }
  return unit === '%' ? `${digits}%` : `${digits} ${unit}`;
}

// Sources behind a node: those of the cards it was built from.
export function nodeSources(node: ExploreNode, widgets: Widget[]): Source[] {
  const all: Source[] = [];
  node.refs.forEach((id) => {
    const w = widgets.find((x) => x.id === id);
    if (w && w.type === 'claim' && w.sources) {
      all.push(...w.sources);
    }
  });
  return uniqueSources(all, 3);
}

// Prepared questions about a node (package `answers` with `mapNode`), only
// those already raised by the playhead, so a question never spoils.
export function nodeQuestions(
  node: ExploreNode,
  answers: Answer[],
  playhead: number | null,
  max = 2,
): Answer[] {
  return answers
    .filter((a) => a.mapNode === node.id)
    .filter((a) => playhead === null || a.t <= playhead + LOOKAHEAD_S)
    .slice(0, max);
}

// The question as sent to the live co-viewer, carrying the node as context
// (POST /v1/ask takes one question string, at most 500 characters).
export function questionWithContext(node: ExploreNode, question: string) {
  const context = node.detail ? `${node.label}: ${node.detail}` : node.label;
  return `${question} (About this part of the episode: ${context})`.slice(0, 500);
}

const cut = (s: string, max: number) =>
  s.length > max ? `${s.slice(0, max - 1)}…` : s;

export function nodeShareCard(node: ExploreNode, sources: Source[]): PhoneCard {
  const card: PhoneCard = {
    type: 'list',
    title: cut(node.label, 80),
    items: [{name: cut(node.label, 80), detail: cut(node.detail || node.label, 200)}],
  };
  if (sources.length) {
    card.sources = sources.map((s) => ({title: cut(s.title, 140), url: s.url}));
  }
  return card;
}

// The night plan as a daily reminder at the chosen bedtime.
export function nightReminderCard(plan: NightPlan, now: Date): PhoneCard {
  const bed = clock(plan.bedtime);
  const wake = clock(plan.wake);
  return {
    type: 'reminder',
    title: `Lights out ${bed}, wake ${wake}`,
    items: [
      {text: `Lights out at ${bed}`, time: bed},
      {
        text: `Wake at ${wake}: ${plan.cycles} cycles of ${
          plan.cycleMinutes
        } min, ${hoursAndMinutes(plan.sleepMinutes)}`,
        time: wake,
      },
    ],
    reminder: {
      title: `Lights out (wake ${wake})`,
      start: nextOccurrence(plan.bedtime, now),
      repeat: 'daily',
    },
  };
}

// A cameo package's card on Home.
export interface CameoMap {
  mediaId: string;
  title: string;
  category: string;
  explore: Explore;
}
