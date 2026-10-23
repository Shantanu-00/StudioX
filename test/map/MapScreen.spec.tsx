import 'react-native';
import {act, fireEvent, render} from '@testing-library/react-native';
import * as React from 'react';
import {useTVEventHandler} from '@amazon-devices/react-native-kepler';

import {Answer, validateExplore, Explore} from '../../src/analysis/schema';
import {MapScreen, MapScreenProps} from '../../src/map/MapScreen';
import {
  crimeAnswers,
  crimeExplore,
  financeCameo,
  sleepAnswers,
  sleepExplore,
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
    expect(screen.getAllByText('Keep watching')).toHaveLength(3);
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
    expect(screen.getByTestId('night-headline').props.children).toBe(
      'Lights out 23:00 → wake 06:30',
    );
    press('right'); // bedtime +15 min
    expect(screen.getByTestId('night-headline').props.children).toBe(
      'Lights out 23:15 → wake 06:45',
    );
    press('down'); // one cycle fewer
    expect(screen.getByTestId('night-headline').props.children).toBe(
      'Lights out 23:15 → wake 05:15',
    );
    expect(screen.getByText('A coaching rule, not medical advice')).toBeTruthy();
    back(); // sim → the node's sheet
    expect(screen.queryByTestId('night-sim')).toBeNull();
    expect(screen.getByTestId('map-sheet')).toBeTruthy();
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
});
