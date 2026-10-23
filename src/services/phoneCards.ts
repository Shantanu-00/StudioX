import {
  clip,
  firstSentence,
  headlineOf,
  isRealStamp,
  stripQuotes,
  uniqueSources,
  VERDICT_WORD,
  whyOf,
} from '../analysis/cardText';
import {formatTime, WINDOW_AFTER} from '../analysis/composer';
import {DossierWidget, Source, Widget} from '../analysis/schema';
import {PhoneCard} from './api';

// Turns what the co-viewer shows into the phone's card shape (docs/
// development/prompts/phone-app.md §5). The phone renders `checklist`,
// `list`, `person`, `link` and `reminder`; the API takes any card up to 8 KB
// (backend/functions/api/util.py), so every TV card maps onto one of those:
// a protocol becomes a checklist, a person a person card, everything else a
// list of name/detail rows. Nothing ahead of the playhead is sent unless the
// viewer revealed it, the same rule as on screen.

// The moment the card is sent from: what the viewer has seen so far.
export interface SendMoment {
  now: number;
  spoilersRevealed: boolean;
}

const MAX_BYTES = 7800; // under the API's 8 KB, with room for the envelope

const cut = (s: string, max: number) =>
  s.length > max ? `${s.slice(0, max - 1)}…` : s;

const row = (name: string, detail: string) => ({
  name: cut(name, 80),
  detail: cut(detail, 200),
});

const phoneSources = (sources?: Source[]) =>
  uniqueSources(sources).map((s) => ({title: cut(s.title, 140), url: s.url}));

const heard = (t0: number | undefined, at?: SendMoment) =>
  !at || at.spoilersRevealed || t0 === undefined || t0 <= at.now + WINDOW_AFTER;

// UTF-8 length of the card as JSON (what the API measures).
function bytes(card: PhoneCard): number {
  const s = JSON.stringify(card);
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    // A surrogate pair is 4 bytes: counted on its high half.
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0xd800 || c >= 0xe000 ? 3 : c < 0xdc00 ? 4 : 0;
  }
  return n;
}

// Drops rows from the end until the card fits the message limit.
function fit(card: PhoneCard): PhoneCard {
  const out = {...card, items: [...card.items]};
  while (bytes(out) > MAX_BYTES && out.items.length > 1) {
    out.items.pop();
  }
  return out;
}

function personCard(w: DossierWidget, at?: SendMoment): PhoneCard {
  const known = w.facts.filter((f) => heard(f.evidence?.t0, at));
  const facts = (known.length ? known.slice(-3) : w.facts.slice(0, 3)).map(
    (f) => cut(firstSentence(f.text), 200),
  );
  return {
    type: 'person',
    title: cut(w.name, 80),
    items: [],
    person: {
      name: cut(w.name, 80),
      role: cut(w.role, 120),
      facts,
      ...(w.image
        ? {imageUrl: w.image.url, credit: cut(`Photo: ${w.image.credit}`, 120)}
        : {}),
    },
  };
}

export function toPhoneCard(w: Widget, at?: SendMoment): PhoneCard {
  const title = cut(headlineOf(w), 80);
  switch (w.type) {
    case 'protocol':
      return fit({
        type: 'checklist',
        title: cut(w.title, 80),
        items: w.steps.map((s) => ({
          text: cut(`${s.label} · ${s.detail}`, 200),
        })),
      });
    case 'entity_list':
      return fit({
        type: 'list',
        title: cut(w.title, 80),
        items: w.items.map((it) => ({
          name: cut(it.dose ? `${it.name} · ${it.dose}` : it.name, 80),
          detail: cut(it.asSaid, 200),
        })),
      });
    case 'claim': {
      const t0 = w.evidence[0]?.t0;
      const said = isRealStamp(t0) ? `${w.speaker} · ${formatTime(t0)}` : w.speaker;
      const card: PhoneCard = {
        type: 'list',
        title,
        items: [
          row(said, `“${stripQuotes(w.claim)}”`),
          row(w.verdict ? VERDICT_WORD[w.verdict] : 'Why', whyOf(w)),
        ],
      };
      const sources = phoneSources(w.sources);
      return fit(sources.length ? {...card, sources} : card);
    }
    case 'timeline': {
      const shown = w.events.filter((e) => heard(e.evidence.t0, at));
      const ahead = w.events.length - shown.length;
      const items = shown.map((e) => row(e.when, e.label));
      if (ahead > 0) {
        items.push(
          row('Later', `${ahead} more later in the episode, kept back so nothing is spoiled.`),
        );
      }
      return fit({type: 'list', title, items});
    }
    case 'relation_graph': {
      const label = new Map(w.nodes.map((n) => [n.id, n.label]));
      return fit({
        type: 'list',
        title,
        items: w.edges.map((e) =>
          row(
            `${label.get(e.from) ?? e.from} → ${label.get(e.to) ?? e.to}`,
            e.conflict ? `${e.label} (accounts conflict)` : e.label,
          ),
        ),
      });
    }
    case 'technique':
      return fit({
        type: 'list',
        title,
        items: [
          row('How', w.caption),
          ...w.phases.map((ph) => row(ph.label, `${ph.seconds} seconds`)),
        ],
      });
    case 'dossier':
      return personCard(w, at);
  }
}

// An answer from the co-viewer (prepared or live) as a list card: the
// question as the title, the answer as one row, its sources below.
export function answerPhoneCard(a: {
  question: string;
  text: string;
  sources: Source[];
  live: boolean;
}): PhoneCard {
  const card: PhoneCard = {
    type: 'list',
    title: clip(a.question, 80),
    items: [
      {
        name: `${a.live ? 'Live answer' : 'Prepared answer'} · AI, not the hosts`,
        detail: cut(a.text, 2000),
      },
    ],
  };
  const sources = phoneSources(a.sources);
  return sources.length ? {...card, sources} : card;
}
