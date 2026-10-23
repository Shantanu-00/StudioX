import 'react-native';
import {act, fireEvent, render} from '@testing-library/react-native';
import * as React from 'react';
import {useTVEventHandler} from '@amazon-devices/react-native-kepler';

import {headlineOf, peopleAt} from '../../src/analysis/cardText';
import {
  composeCard,
  suggestedQuestions,
  WINDOW_AFTER,
} from '../../src/analysis/composer';
import {localPackage} from '../../src/analysis/packageLoader';
import {Widget} from '../../src/analysis/schema';
import {simForWidget} from '../../src/map/sims';
import {
  AnswerState,
  CoViewPanel,
  LEFT_SETTLE_MS,
  LIST,
  PanelView,
} from '../../src/player/CoViewPanel';

// The real pipeline packages bundled with the app.
const science = localPackage('science-ep42')!.analysis;
const crime = localPackage('crime-case104')!.analysis;

const setup = (extra: object = {}, analysis = science, t = 12) => {
  const onAsk = jest.fn();
  const onSeek = jest.fn();
  const onView = jest.fn();
  const people = peopleAt(analysis.widgets, t, WINDOW_AFTER);
  const ids = new Set(people.map((p) => p.id));
  const cards = composeCard(analysis, t).widgets.filter((w) => !ids.has(w.id));
  const props = {
    open: true,
    title: analysis.segments[0].title,
    cards,
    people,
    caption: null,
    footer: 'Analysed by StudioX · 22 Oct',
    now: t,
    spoilersRevealed: false,
    onSeek,
    onLocked: jest.fn(),
    view: LIST as PanelView,
    onView,
    focusKey: null,
    asks: suggestedQuestions(analysis, t),
    onAsk,
    ...extra,
  };
  const screen = render(<CoViewPanel {...props} />);
  return {screen, onAsk, onSeek, onView, cards, people, props};
};

describe('CoViewPanel list', () => {
  it('shows the segment title, collapsed cards with headlines, and the footer', () => {
    const {screen, cards} = setup();
    expect(screen.getByText(science.segments[0].title)).toBeTruthy();
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.length).toBeLessThanOrEqual(3);
    // Curator headlines, collapsed: no claim text, sources or why yet.
    // (Package text changes as the pipeline reruns: read it from the data.)
    cards.forEach((w) => expect(screen.getByText(headlineOf(w))).toBeTruthy());
    expect(cards.every((w) => !!w.headline)).toBe(true);
    expect(screen.getAllByText('Fact check').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Needs context').length).toBeGreaterThan(0);
    expect(screen.queryByText('Why')).toBeNull();
    expect(screen.queryByText(/news\.harvard\.edu/)).toBeNull();
    expect(screen.getByText('Analysed by StudioX · 22 Oct')).toBeTruthy();
    // No all-caps tags, no filler.
    expect(screen.queryByText('AI CO-VIEWER')).toBeNull();
    expect(screen.queryByText(/Nothing analysed/)).toBeNull();
  });

  it('expands a card on SELECT through onView', () => {
    const {screen, onView} = setup();
    fireEvent.press(screen.getByTestId('card-claims-s1-1'));
    expect(onView).toHaveBeenCalledWith(
      {kind: 'card', id: 'claims-s1-1'},
      'card-claims-s1-1',
    );
  });

  it('offers up to two questions and opens the one selected', () => {
    const {screen, onAsk} = setup({}, science, 21);
    expect(screen.getByTestId('ask-0')).toBeTruthy();
    expect(screen.queryByTestId('ask-2')).toBeNull();
    fireEvent.press(screen.getByTestId('ask-0'));
    expect(onAsk).toHaveBeenCalledWith(0);
  });

  it('puts people in a ribbon with first and last name', () => {
    const {screen, onView, people} = setup({}, crime, 10);
    expect(people.map((p) => p.id)).toEqual(['people-s1-1']);
    expect(screen.getByText('Marcus')).toBeTruthy();
    expect(screen.getByText('Vance')).toBeTruthy();
    fireEvent.press(screen.getByTestId('person-people-s1-1'));
    expect(onView).toHaveBeenCalledWith(
      {kind: 'person', id: 'people-s1-1'},
      'person-people-s1-1',
    );
  });
});

describe('CoViewPanel details', () => {
  it('shows a fact check in full with one Jump action and compact sources', () => {
    const {screen, onSeek} = setup({view: {kind: 'card', id: 'claims-s1-1'}});
    expect(screen.getByTestId('detail-claims-s1-1')).toBeTruthy();
    expect(screen.getByText('Why')).toBeTruthy();
    expect(screen.getAllByText(/ · news\.harvard\.edu/).length).toBe(1);
    expect(screen.queryByTestId('card-claims-s1-1')).toBeNull();
    fireEvent.press(screen.getByTestId('jump-6'));
    expect(onSeek).toHaveBeenCalledWith(6.76);
  });

  it('offers Send to phone on a routine only when a phone is paired', () => {
    const view = {kind: 'card', id: 'protocol-s1-1'};
    const plain = setup({view}, science, 12).screen;
    expect(plain.queryByTestId('share-protocol-s1-1')).toBeNull();
    const send = jest.fn();
    const paired = setup(
      {view, share: {phoneName: "Ari's phone", status: () => 'idle', send}},
      science,
      12,
    ).screen;
    fireEvent.press(paired.getByTestId('share-protocol-s1-1'));
    expect(send).toHaveBeenCalledWith('protocol-s1-1');
  });

  it('offers “Try it” first on the sleep routine when the Map has its sim', () => {
    const view = {kind: 'card', id: 'protocol-s1-1'};
    const onTry = jest.fn();
    const explore = science.explore!;
    const {screen} = setup(
      {view, onTry, onBack: jest.fn(), simFor: (w: Widget) => simForWidget(explore, w)},
      science,
      12,
    );
    const tryIt = screen.getByTestId('try-protocol-s1-1');
    expect(screen.getByText('Try it: Plan your night')).toBeTruthy();
    expect(tryIt.props.hasTVPreferredFocus).toBe(true);
    expect(screen.getByTestId('detail-back').props.hasTVPreferredFocus).toBeFalsy();
    fireEvent.press(tryIt);
    expect(onTry).toHaveBeenCalledWith('night');
    // A card no sim belongs to has no Try it.
    const claim = setup(
      {view: {kind: 'card', id: 'claims-s1-1'}, onTry, simFor: (w: Widget) => simForWidget(explore, w)},
      science,
      12,
    ).screen;
    expect(claim.queryByTestId('try-claims-s1-1')).toBeNull();
    // Without the Map wiring there is no Try it either.
    expect(setup({view}, science, 12).screen.queryByTestId('try-protocol-s1-1')).toBeNull();
  });

  it('shows an answer with a Jump action and sources folded away', () => {
    const answer: AnswerState = {
      question: 'Is the 37% from a real study?',
      t: 12,
      status: 'ready',
      text: 'Probably Naska et al. (2007) [0:08].',
      cites: [8],
      sources: [{title: 'Naska 2007', url: 'https://example.org/naska'}],
      live: false,
    };
    const {screen, onSeek} = setup({answer});
    expect(screen.getByText('Prepared answer · AI, not the hosts')).toBeTruthy();
    expect(screen.queryByTestId('ask-0')).toBeNull();
    fireEvent.press(screen.getByTestId('answer-cite-8'));
    expect(onSeek).toHaveBeenCalledWith(8);
    expect(screen.queryByText('Naska 2007 · example.org')).toBeNull();
    fireEvent.press(screen.getByTestId('answer-sources'));
    expect(screen.getByText('Naska 2007 · example.org')).toBeTruthy();
  });
});

describe('CoViewPanel Map action', () => {
  it('offers Map in the header only when the episode has a map', () => {
    const without = setup();
    expect(without.screen.queryByTestId('panel-map')).toBeNull();
    without.screen.unmount();
    const onMap = jest.fn();
    const {screen} = setup({onMap});
    fireEvent.press(screen.getByTestId('panel-map'));
    expect(onMap).toHaveBeenCalled();
  });
});

// The kepler preset mocks useTVEventHandler as jest.fn(): drive the handler
// registered last, as the remote would.
const press = (eventType: string) => {
  const calls = (useTVEventHandler as unknown as jest.Mock).mock.calls;
  act(() => {
    calls[calls.length - 1][0]({eventType, eventKeyAction: 0});
  });
};
const settle = () =>
  act(() => {
    jest.advanceTimersByTime(LEFT_SETTLE_MS + 20);
  });
const layoutAt = (x: number) => ({
  nativeEvent: {layout: {x, y: 0, width: 100, height: 40}},
});

describe('CoViewPanel person', () => {
  const person = {kind: 'person', id: 'people-s1-1'} as PanelView;

  it('rings the portrait in white while it has focus', () => {
    const {screen, people} = setup({}, science, 3);
    const id = people[0].id;
    expect(screen.queryByTestId(`person-ring-${id}`)).toBeNull();
    fireEvent(screen.getByTestId(`person-${id}`), 'focus');
    const ring = Object.assign(
      {},
      ...[screen.getByTestId(`person-ring-${id}`).props.style].flat(),
    );
    expect(ring).toEqual(
      expect.objectContaining({borderWidth: 2, borderColor: '#F5F5F7'}),
    );
    fireEvent(screen.getByTestId(`person-${id}`), 'blur');
    expect(screen.queryByTestId(`person-ring-${id}`)).toBeNull();
  });

  it('opens with the photo, its credit, whole facts and no Jump to 0:00', () => {
    const {screen} = setup({view: person, onBack: jest.fn()}, science, 12);
    expect(screen.getByTestId('detail-people-s1-1')).toBeTruthy();
    expect(screen.getByTestId('dossier-portrait')).toBeTruthy();
    expect(screen.getByText(/^Photo: /)).toBeTruthy();
    expect(screen.queryByText('Dr.')).toBeNull();
    expect(screen.queryByText('Jump to 0:00')).toBeNull();
    expect(screen.queryByText('0:00')).toBeNull();
  });

  it('offers no Jump to at all without a real timestamp', () => {
    const w = {
      ...science.widgets.find((x) => x.id === 'people-s1-1')!,
      evidence: [{t0: 0, t1: 4}],
      facts: [{text: 'Only a reference fact.', source: 'Wikipedia'}],
    };
    const {screen} = setup(
      {view: person, people: [w], onBack: jest.fn()},
      science,
      12,
    );
    expect(screen.queryByText(/^Jump to/)).toBeNull();
    expect(screen.getByTestId('detail-back')).toBeTruthy();
  });
});

describe('CoViewPanel leaving a detail', () => {
  beforeAll(() => jest.useFakeTimers());
  afterAll(() => jest.useRealTimers());
  beforeEach(() => (useTVEventHandler as unknown as jest.Mock).mockClear());
  const card = {kind: 'card', id: 'claims-s1-1'} as PanelView;

  it('has a focusable on-screen Back that takes the BACK step', () => {
    const onBack = jest.fn();
    const {screen} = setup({view: card, onBack});
    fireEvent.press(screen.getByTestId('detail-back'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('closes with LEFT from Back once it has settled on it', () => {
    const onBack = jest.fn();
    const {screen} = setup({view: card, onBack});
    fireEvent(screen.getByTestId('detail-back'), 'focus');
    press('left'); // the same key that moved focus here
    expect(onBack).not.toHaveBeenCalled();
    settle();
    press('left');
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('does not close with LEFT from an action that is not leftmost', () => {
    const onBack = jest.fn();
    const {screen} = setup({view: card, onBack});
    fireEvent(screen.getByTestId('jump-6-slot'), 'layout', layoutAt(76));
    fireEvent(screen.getByTestId('jump-6'), 'focus');
    settle();
    press('left');
    expect(onBack).not.toHaveBeenCalled();
    // Wrapped to the start of a second line, the same action is leftmost.
    fireEvent(screen.getByTestId('jump-6-slot'), 'layout', layoutAt(0));
    fireEvent(screen.getByTestId('jump-6'), 'focus');
    settle();
    press('left');
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('closes an answer with Back and LEFT too', () => {
    const onBack = jest.fn();
    const answer: AnswerState = {
      question: 'Is the 37% from a real study?',
      t: 12,
      status: 'ready',
      text: 'Probably Naska et al. (2007).',
      cites: [0],
      sources: [],
      live: true,
    };
    const {screen} = setup({answer, onBack});
    // A 0 s cite is not a moment: no "Jump to 0:00".
    expect(screen.queryByText('Jump to 0:00')).toBeNull();
    fireEvent(screen.getByTestId('detail-back'), 'focus');
    settle();
    press('left');
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('scrolls long text with the D-pad from a focusable reader', () => {
    const {screen} = setup({view: card, onBack: jest.fn()});
    const reader = screen.getByTestId('detail-reader');
    expect(reader.props.focusable).toBe(false);
    expect(screen.queryByTestId('detail-reader-hint')).toBeNull();
    const scroll = screen.getByTestId('detail-reader-scroll');
    fireEvent(scroll, 'layout', {
      nativeEvent: {layout: {x: 0, y: 0, width: 312, height: 300}},
    });
    fireEvent(scroll, 'contentSizeChange', 312, 700);
    expect(screen.getByTestId('detail-reader').props.focusable).toBe(true);
    expect(screen.getByText('Press ▲ to read more')).toBeTruthy();
    fireEvent(screen.getByTestId('detail-reader'), 'focus');
    expect(screen.getByText('Press ▲ ▼ to scroll')).toBeTruthy();
    press('down');
    press('down');
    expect(screen.getByText('Press ▼ for the actions')).toBeTruthy();
    press('up');
    expect(screen.getByText('Press ▲ ▼ to scroll')).toBeTruthy();
  });
});

describe('CoViewPanel text', () => {
  it('never clamps content text in the list or a detail', () => {
    const list = setup({}, science, 12).screen;
    // Only the one-word verdicts keep a single line.
    const clamped = (s: typeof list) =>
      s.UNSAFE_root.findAll(
        (n) =>
          typeof n.type === 'string' &&
          n.props.numberOfLines != null &&
          !String(n.props.testID ?? '').startsWith('verdict-'),
      ).length;
    expect(clamped(list)).toBe(0);
    list.unmount();
    const detail = setup(
      {view: {kind: 'card', id: 'claims-s1-1'}, onBack: jest.fn()},
      science,
      12,
    ).screen;
    expect(clamped(detail)).toBe(0);
  });
});
