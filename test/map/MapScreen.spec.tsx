import 'react-native';
import {act, fireEvent, render} from '@testing-library/react-native';
import * as React from 'react';
import {useTVEventHandler} from '@amazon-devices/react-native-kepler';

import {Answer, validateExplore, Explore} from '../../src/analysis/schema';
import {MapScreen, MapScreenProps} from '../../src/map/MapScreen';
import {BUNDLED} from '../../src/analysis/packages';
import {
  clone,
  crimeAnswers,
  crimeExplore,
  financeCameo,
  historyCameo,
  sleepAnswers,
  sleepExplore,
  techCameo,
} from '../fixtures/explore';

const sleep = validateExplore(sleepExplore) as Explore;
const crime = validateExplore(crimeExplore) as Explore;

const setup = (over: Partial<MapScreenProps> = {}) => {
  let back: (() => boolean) | null = null;
  const props: MapScreenProps = {
    explore: sleep,
    answers: sleepAnswers as Answer[],
    widgets: [],
    mediaId: 'science-ep42',
    sourceTitle: 'Elite Recovery Protocols',
    playhead: 37,
    frame: true,
    sessionId: null,
    link: null,
    confirm: null,
    onPlayMoment: jest.fn(),
    onKeepWatching: jest.fn(),
    onClose: jest.fn(),
    registerBack: (h) => {
      back = h;
    },
    ...over,
  };
  const screen = render(<MapScreen {...props} />);
  return {screen, props, back: () => act(() => void back?.())};
};

// The kepler preset mocks useTVEventHandler as jest.fn(): drive the handler
// registered last (the innermost screen of the latest render), as the remote
// would.
const press = (eventType: string) => {
  const calls = (useTVEventHandler as unknown as jest.Mock).mock.calls;
  act(() => {
    calls[calls.length - 1][0]({eventType, eventKeyAction: 0});
  });
};

beforeAll(() => {
  jest.useFakeTimers();
});
afterAll(() => {
  jest.useRealTimers();
});
beforeEach(() => (useTVEventHandler as unknown as jest.Mock).mockClear());

describe('MapScreen', () => {
  it('draws the header and every node of a flow map', () => {
    const {screen} = setup();
    expect(screen.getByText('The sleep routine')).toBeTruthy();
    expect(screen.getByText('Health · Elite Recovery Protocols, paused at 0:37')).toBeTruthy();
    ['n1', 'n2', 'n3', 'n4'].forEach((id) =>
      expect(screen.getByTestId(`map-node-${id}`)).toBeTruthy(),
    );
    expect(screen.getByText('Sleep in 90-minute blocks')).toBeTruthy();
    expect(screen.getByText('Back to the episode')).toBeTruthy();
  });

  it('locks what has not been said yet: crime paused at 0:11', () => {
    const {screen} = setup({
      explore: crime,
      answers: crimeAnswers as Answer[],
      mediaId: 'crime-case104',
      playhead: 11,
    });
    expect(screen.getByText('Alibi: at the diner all evening')).toBeTruthy();
    expect(screen.getByText('His phone pings at Pier 9')).toBeTruthy();
    expect(screen.queryByText('A burner phone hits the pavement')).toBeNull();
    // The case board: what is still to come is face down, taped "Not yet".
    expect(screen.getAllByText('Not yet')).toHaveLength(3);
    expect(screen.getByTestId('map-backdrop-caseboard')).toBeTruthy();
    // The contradiction is between two unlocked events, so it is labelled.
    expect(screen.getByText('contradicts')).toBeTruthy();
  });

  it('opens a node: play its moment, ask its question, BACK unwinds', () => {
    const {screen, props, back} = setup({
      explore: crime,
      answers: crimeAnswers as Answer[],
      playhead: 12,
    });
    fireEvent.press(screen.getByTestId('map-node-c2'));
    expect(screen.getByTestId('map-sheet')).toBeTruthy();
    expect(screen.getByText('10:14 PM · Said at 0:08')).toBeTruthy();
    fireEvent.press(screen.getByTestId('sheet-ask-0'));
    expect(screen.getByTestId('map-answer')).toBeTruthy();
    expect(screen.getByText(/^Not by itself\./)).toBeTruthy();
    back(); // answer → node
    expect(screen.queryByTestId('map-answer')).toBeNull();
    fireEvent.press(screen.getByTestId('sheet-play'));
    expect(props.onPlayMoment).toHaveBeenCalledWith(8);
    back(); // sheet → map
    expect(screen.queryByTestId('map-sheet')).toBeNull();
    back(); // map → close
    expect(props.onClose).toHaveBeenCalled();
  });

  it('a locked node offers only Keep watching', () => {
    const {screen, props} = setup({explore: crime, playhead: 12});
    fireEvent.press(screen.getByTestId('map-node-c5'));
    expect(screen.queryByTestId('sheet-play')).toBeNull();
    fireEvent.press(screen.getByTestId('sheet-keep-watching'));
    expect(props.onKeepWatching).toHaveBeenCalled();
  });

  it('steps through one piece at a time with LEFT/RIGHT, and BACK leaves step mode', () => {
    const {screen, props, back} = setup();
    fireEvent.press(screen.getByTestId('map-step-toggle'));
    expect(screen.getByTestId('map-step-progress').props.children).toBe('1 of 4');
    press('right');
    press('right');
    expect(screen.getByTestId('map-step-progress').props.children).toBe('3 of 4');
    expect(screen.getByText('Keep the room cool')).toBeTruthy();
    press('right');
    press('right'); // stops at the end
    expect(screen.getByTestId('map-step-progress').props.children).toBe('4 of 4');
    press('left');
    expect(screen.getByTestId('map-step-progress').props.children).toBe('3 of 4');
    back();
    expect(screen.queryByTestId('map-step-progress')).toBeNull();
    expect(screen.getByTestId('map-node-n3')).toBeTruthy();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('opens the night sim from a node and redraws with the remote', () => {
    const {screen, back} = setup();
    fireEvent.press(screen.getByTestId('map-node-n1'));
    fireEvent.press(screen.getByTestId('sheet-try'));
    expect(screen.getByTestId('night-sim')).toBeTruthy();
    const wake = () => screen.getByTestId('night-wake').props.children;
    expect(wake()).toBe('Wake at 06:30');
    press('right'); // bedtime +15 min
    expect(wake()).toBe('Wake at 06:45');
    // UP/DOWN move between the values; LEFT on Cycles is one fewer.
    fireEvent(screen.getByTestId('night-cycles'), 'focus');
    press('left');
    expect(wake()).toBe('Wake at 05:15');
    expect(screen.getByTestId('night-asleep').props.children).toBe(
      '6 h asleep · the guest said 5 × 90',
    );
    expect(screen.getByText(/^R90 is a coaching method/)).toBeTruthy();
    back(); // sim → the node's sheet
    expect(screen.queryByTestId('night-sim')).toBeNull();
    expect(screen.getByTestId('map-sheet')).toBeTruthy();
  });

  it('opens straight into a sim from the player, and leaving it leaves the Map', () => {
    const {screen, props, back} = setup({initialSim: 'night'});
    expect(screen.getByTestId('night-sim')).toBeTruthy();
    expect(screen.queryByTestId('map-screen')).toBeNull();
    expect(screen.getByTestId('night-done').props.accessibilityLabel).toBe(
      'Done, back to the episode',
    );
    back(); // BACK → the episode, not the map
    expect(props.onClose).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByTestId('night-done'));
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });

  it('ignores an unknown initial sim and shows the map', () => {
    const {screen} = setup({initialSim: 'nope'});
    expect(screen.queryByTestId('night-sim')).toBeNull();
    expect(screen.getByTestId('map-screen')).toBeTruthy();
  });

  it('a cameo shows everything, offers no moment to play, and its growth sim', () => {
    const explore = validateExplore(financeCameo.explore) as Explore;
    const {screen} = setup({
      explore,
      answers: [],
      mediaId: 'cameo-finance',
      sourceTitle: 'Example transcript written by StudioX',
      playhead: null,
      frame: false,
      onPlayMoment: undefined,
    });
    expect(screen.getByText('Money · Example transcript written by StudioX')).toBeTruthy();
    expect(screen.queryByText('Keep watching')).toBeNull();
    expect(screen.getAllByText('$200')).toHaveLength(2);
    fireEvent.press(screen.getByTestId('map-sim-growth'));
    expect(screen.getByTestId('growth-sim')).toBeTruthy();
    expect(screen.getAllByText('Start in 10 years').length).toBeGreaterThan(0);
    expect(screen.getByTestId('growth-done')).toBeTruthy();
  });

  it('says how to link a phone instead of offering Send when unpaired', () => {
    const {screen} = setup();
    fireEvent.press(screen.getByTestId('map-node-n3'));
    expect(screen.queryByTestId('sheet-send')).toBeNull();
    expect(screen.getByTestId('sheet-send-hint').props.children).toBe(
      'Link a phone from Home to send this to it.',
    );
  });

  it('sends a piece to a paired phone', async () => {
    const fetchMock = globalThis.fetch as jest.Mock;
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/devices')) {
        return {ok: true, status: 200, json: async () => ({deviceId: 'dev12345', deviceSecret: 'secret-secret-123'})};
      }
      return {ok: true, status: 200, json: async () => ({id: 'm1'})};
    });
    const confirm = jest.fn();
    const {screen} = setup({
      link: {linkId: 'link1234', phoneName: 'Ari’s phone'},
      confirm,
    });
    fireEvent.press(screen.getByTestId('map-node-n3'));
    expect(screen.getByText('Or ask by voice on your phone')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId('sheet-send'));
      await Promise.resolve();
      jest.runOnlyPendingTimers();
    });
    await act(async () => {
      await Promise.resolve();
    });
    const share = fetchMock.mock.calls.find((c) => String(c[0]).includes('/messages'));
    expect(share).toBeTruthy();
    const body = JSON.parse(share![1].body);
    expect(body).toMatchObject({kind: 'share', card: {type: 'list', title: 'Keep the room cool'}});
    fetchMock.mockReset();
    fetchMock.mockImplementation(() => Promise.reject(new Error('network disabled in tests')));
  });

  it('draws the genre scene for each category', () => {
    const scenes: Array<[unknown, string | null]> = [
      [sleepExplore, 'nightsky'],
      [crimeExplore, 'caseboard'],
      [financeCameo.explore, 'ledger'],
      [techCameo.explore, 'signal'],
      [historyCameo.explore, 'archive'],
      [{...clone(sleepExplore), category: 'other'}, null],
    ];
    scenes.forEach(([raw, motif]) => {
      const {screen} = setup({explore: validateExplore(raw) as Explore, playhead: null});
      if (motif) {
        expect(screen.getByTestId(`map-backdrop-${motif}`)).toBeTruthy();
      } else {
        expect(screen.queryByTestId(/^map-backdrop-/)).toBeNull();
      }
      screen.unmount();
    });
  });

  it('health never locks, even at the start of the episode', () => {
    const {screen} = setup({playhead: 0});
    expect(screen.queryByText('Keep watching')).toBeNull();
    expect(screen.getByText('Results in 7 days?')).toBeTruthy();
  });

  it('starts on Play; the story never runs by itself', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const {screen} = setup();
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(warn).toHaveBeenCalledWith('[map] restore map-play ok');
    expect(screen.queryByTestId('map-story-caption')).toBeNull();
    expect(screen.queryByTestId('map-pulse')).toBeNull();
    expect(screen.getByTestId('map-title')).toBeTruthy();
    warn.mockRestore();
  });

  it('plays the story node by node, any key pauses, Play resumes', () => {
    const {screen} = setup();
    const label = () => screen.getByTestId('map-story-label').props.children;
    const meta = () => screen.getByTestId('map-story-meta').props.children as string;
    fireEvent.press(screen.getByTestId('map-play'));
    expect(label()).toBe('Sleep in 90-minute blocks');
    expect(meta()).toBe('1 of 4');
    act(() => {
      jest.advanceTimersByTime(1600);
    });
    expect(label()).toBe('Two supplements before bed');
    expect(screen.getByTestId('map-pulse')).toBeTruthy();
    expect(screen.getByText('Any key pauses the story')).toBeTruthy();
    press('down'); // any key
    expect(meta()).toBe('2 of 4 · Paused');
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(label()).toBe('Two supplements before bed');
    expect(screen.getByText('Resume')).toBeTruthy();
    act(() => {
      jest.advanceTimersByTime(400);
    });
    fireEvent.press(screen.getByTestId('map-play'));
    act(() => {
      jest.advanceTimersByTime(1600);
    });
    expect(label()).toBe('Keep the room cool');
    expect(meta()).toBe('3 of 4');
    act(() => {
      jest.advanceTimersByTime(1600);
    });
    expect(meta()).toBe('4 of 4 · promised result');
    act(() => {
      jest.advanceTimersByTime(1600);
    });
    expect(meta()).toBe('4 of 4 · promised result · The end');
    expect(screen.getByText('Play again')).toBeTruthy();
    press('up'); // a key after the end puts the header back
    expect(screen.queryByTestId('map-story-caption')).toBeNull();
    expect(screen.getByTestId('map-title')).toBeTruthy();
  });

  it('the story pauses when a sheet opens, and BACK pauses before it leaves', () => {
    const {screen, props, back} = setup();
    fireEvent.press(screen.getByTestId('map-play'));
    fireEvent.press(screen.getByTestId('map-node-n1'));
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    back(); // the sheet
    expect(screen.getByTestId('map-story-meta').props.children).toBe('1 of 4 · Paused');
    act(() => {
      jest.advanceTimersByTime(400);
    });
    fireEvent.press(screen.getByTestId('map-play'));
    back(); // pauses the story, does not leave
    expect(props.onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('map-story-meta').props.children).toBe('1 of 4 · Paused');
    back();
    expect(props.onClose).toHaveBeenCalled();
  });

  it('stops its timer when the map unmounts mid-story', () => {
    const {screen} = setup();
    fireEvent.press(screen.getByTestId('map-play'));
    screen.unmount();
    expect(() =>
      act(() => {
        jest.advanceTimersByTime(10000);
      }),
    ).not.toThrow();
  });

  it('a sheet: Back first, LEFT closes it, rapid LEFT is safe, focus returns to the node', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const {screen, props} = setup();
    fireEvent.press(screen.getByTestId('map-node-n3'));
    expect(screen.getByTestId('sheet-back')).toBeTruthy();
    press('left');
    press('left');
    expect(screen.queryByTestId('map-sheet')).toBeNull();
    expect(props.onClose).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(10);
    });
    expect(warn).toHaveBeenCalledWith('[map] restore n3 ok');
    fireEvent.press(screen.getByTestId('map-node-n2'));
    fireEvent.press(screen.getByTestId('sheet-back'));
    expect(screen.queryByTestId('map-sheet')).toBeNull();
    warn.mockRestore();
  });

  it('a node without a moment offers none to play', () => {
    const e = clone(sleepExplore);
    const n3 = e.nodes[2] as {t: number | null; t1: number | null};
    n3.t = null;
    n3.t1 = null;
    const {screen} = setup({explore: validateExplore(e) as Explore});
    fireEvent.press(screen.getByTestId('map-node-n3'));
    expect(screen.queryByTestId('sheet-play')).toBeNull();
    expect(screen.queryByText(/Jump to/)).toBeNull();
  });

  it('a figure shows its value large and never a verdict', () => {
    const explore = validateExplore(
      (BUNDLED['cameo-finance'] as {explore: unknown}).explore,
    ) as Explore;
    const {screen} = setup({explore, playhead: null, frame: false, answers: []});
    expect(screen.getByText('144,000 USD')).toBeTruthy();
    // Only the claim without a figure keeps its verdict.
    expect(screen.getAllByTestId('verdict-UNVERIFIED')).toHaveLength(1);
    expect(screen.queryAllByTestId('verdict-NUANCED')).toHaveLength(0);
    fireEvent.press(screen.getByTestId('map-node-n3'));
    expect(screen.getByTestId('sheet-value').props.children).toBe('144,000 USD');
    expect(screen.getAllByTestId('verdict-UNVERIFIED')).toHaveLength(1); // the map's n7
  });

  it('a photo shows with its credit: on the archive card, the sheet and the step card', () => {
    const e = clone(historyCameo.explore) as typeof historyCameo.explore & {
      nodes: Array<Record<string, unknown>>;
    };
    e.nodes[1].image = {
      url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a0/Gagarin.jpg/320px-Gagarin.jpg',
      credit: 'Public domain',
    };
    const explore = validateExplore(e) as Explore;
    const {screen, back} = setup({explore, playhead: null, frame: false});
    expect(screen.getByTestId('map-node-image-h2')).toBeTruthy();
    fireEvent.press(screen.getByTestId('map-node-h2'));
    expect(screen.getByTestId('sheet-image')).toBeTruthy();
    expect(screen.getAllByText('Photo: Public domain').length).toBeGreaterThan(0);
    back();
    // Step-through starts on the piece focused last.
    fireEvent.press(screen.getByTestId('map-step-toggle'));
    expect(screen.getByTestId('map-step-progress').props.children).toBe('2 of 3');
    expect(screen.getByTestId('map-step-image')).toBeTruthy();
    expect(screen.getByText('Photo: Public domain')).toBeTruthy();
  });

  it('tech steps through with the large glyph', () => {
    const explore = validateExplore(techCameo.explore) as Explore;
    const {screen} = setup({explore, playhead: null, frame: false});
    expect(screen.getByTestId('map-backdrop-signal')).toBeTruthy();
    fireEvent.press(screen.getByTestId('map-step-toggle'));
    expect(screen.getAllByTestId('glyph-globe')).toHaveLength(1);
    expect(screen.getByText('Relations need joins')).toBeTruthy();
  });
});
