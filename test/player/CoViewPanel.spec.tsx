import 'react-native';
import {fireEvent, render} from '@testing-library/react-native';
import * as React from 'react';

import {headlineOf, peopleAt} from '../../src/analysis/cardText';
import {
  composeCard,
  suggestedQuestions,
  WINDOW_AFTER,
} from '../../src/analysis/composer';
import {localPackage} from '../../src/analysis/packageLoader';
import {
  AnswerState,
  CoViewPanel,
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
