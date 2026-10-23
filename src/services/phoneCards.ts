import {Widget} from '../analysis/schema';
import {PhoneCard} from './api';

// Turns a TV card into the phone's card shape (docs/development/prompts/
// phone-app.md §5): a protocol becomes a checklist, an entity list a list.
// Other widget types are not shareable. Strings are bounded for the 8 KB
// message limit.
const cut = (s: string, max: number) =>
  s.length > max ? `${s.slice(0, max - 1)}…` : s;

export const isShareable = (w: Widget) =>
  w.type === 'protocol' || w.type === 'entity_list';

export function toPhoneCard(w: Widget): PhoneCard | null {
  switch (w.type) {
    case 'protocol':
      return {
        type: 'checklist',
        title: cut(w.title, 80),
        items: w.steps.map((s) => ({
          text: cut(`${s.label} · ${s.detail}`, 200),
        })),
      };
    case 'entity_list':
      return {
        type: 'list',
        title: cut(w.title, 80),
        items: w.items.map((it) => ({
          name: cut(it.dose ? `${it.name} · ${it.dose}` : it.name, 80),
          detail: cut(it.asSaid, 200),
        })),
      };
    default:
      return null;
  }
}
