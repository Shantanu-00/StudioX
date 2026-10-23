import {ANALYSES} from '../../src/analysis/fixtures';
import {EntityListWidget} from '../../src/analysis/schema';
import {answerPhoneCard, toPhoneCard} from '../../src/services/phoneCards';

describe('phone cards', () => {
  const widgets = [
    ...ANALYSES['science-ep42'].widgets,
    ...ANALYSES['crime-case104'].widgets,
  ];
  const byId = (id: string) => widgets.find((w) => w.id === id)!;

  it('turns a protocol into a checklist and an entity list into a list', () => {
    expect(toPhoneCard(byId('evening'))).toMatchObject({
      type: 'checklist',
      title: 'Evening routine, as described',
      items: expect.arrayContaining([
        {text: 'Cool the room · Bedroom kept at 18 °C'},
      ]),
    });
    expect(toPhoneCard(byId('compounds'))).toMatchObject({
      type: 'list',
      items: expect.arrayContaining([
        expect.objectContaining({name: 'Apigenin · 50 mg'}),
      ]),
    });
  });

  it('sends a fact check as who said what, the verdict and why', () => {
    const card = toPhoneCard(byId('siesta-claim'));
    expect(card.type).toBe('list');
    expect(card.items).toEqual([
      {
        name: 'Dr. Julian, citing "Harvard clinical data" · 0:05',
        detail: '“Midday sleep cuts cardiovascular strain by 37 percent.”',
      },
      {name: 'Needs context', detail: expect.stringMatching(/^Likely refers to Naska/)},
    ]);
  });

  it('sends only the timeline events heard so far unless revealed', () => {
    const w = byId('chronology');
    const early = toPhoneCard(w, {now: 9, spoilersRevealed: false});
    // Heard by 9 s (+4 s window): 9:30 PM, 10:14 PM, 10:20 PM; two kept back.
    expect(early.items.map((i) => ('name' in i ? i.name : ''))).toEqual([
      '9:30 PM',
      '10:14 PM',
      '10:20 PM',
      'Later',
    ]);
    expect(JSON.stringify(early)).not.toContain('12:00 AM');
    const all = toPhoneCard(w, {now: 9, spoilersRevealed: true});
    expect(all.items).toHaveLength(5);
  });

  it('sends connections as rows, a technique with its phases, a person as a person', () => {
    expect(toPhoneCard(byId('links')).items).toContainEqual({
      name: 'Marcus Vance → Pier 9',
      detail: 'ping 10:14 PM (accounts conflict)',
    });
    expect(toPhoneCard(byId('r90')).items[0]).toMatchObject({name: 'How'});
    const person = toPhoneCard(byId('vance'), {now: 2, spoilersRevealed: false});
    expect(person).toMatchObject({
      type: 'person',
      person: {name: 'Marcus Vance', role: 'Suspect · logistics manager'},
    });
    // The 8 s fact is not heard yet at 2 s.
    expect(person.person!.facts).toEqual([
      'Swore he never left the Westside Diner, 9:30–11:00 PM.',
    ]);
  });

  it('sends an answer with its kind, text and sources', () => {
    const card = answerPhoneCard({
      question: 'Is the 37% from a real study?',
      text: 'Probably Naska et al. (2007) [0:08].',
      sources: [{title: 'Naska 2007', url: 'https://example.org/naska'}],
      live: false,
    });
    expect(card).toEqual({
      type: 'list',
      title: 'Is the 37% from a real study?',
      items: [
        {
          name: 'Prepared answer · AI, not the hosts',
          detail: 'Probably Naska et al. (2007) [0:08].',
        },
      ],
      sources: [{title: 'Naska 2007', url: 'https://example.org/naska'}],
    });
  });

  it('keeps every card under the 8 KB message limit', () => {
    const base = byId('compounds') as EntityListWidget;
    const big: EntityListWidget = {
      ...base,
      items: Array.from({length: 60}, (_, i) => ({
        ...base.items[0],
        name: `Item ${i} ${'é'.repeat(70)}`,
        asSaid: '“'.repeat(190),
      })),
    };
    const card = toPhoneCard(big);
    const utf8 = encodeURIComponent(JSON.stringify(card)).replace(/%[0-9A-F]{2}/g, 'x');
    expect(utf8.length).toBeLessThan(8192);
    expect(card.items.length).toBeGreaterThan(0);
    expect(card.items.length).toBeLessThan(60);
  });
});
