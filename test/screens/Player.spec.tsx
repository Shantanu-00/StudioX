import 'react-native';
import {act, render} from '@testing-library/react-native';
import * as React from 'react';

import {EPISODES, uploadEpisode} from '../../src/data/episodes';
import {Player, stepFor} from '../../src/screens/Player';

describe('Player', () => {
  it('mounts the video surface, the Vega SeekBar and a buffering state', () => {
    const registerBack = jest.fn();
    const screen = render(
      <Player
        episode={EPISODES[0]}
        onExit={jest.fn()}
        registerBack={registerBack}
      />,
    );
    expect(screen.getByTestId('seekbar')).toBeTruthy();
    expect(screen.getByTestId('player-loading')).toBeTruthy();
    expect(registerBack).toHaveBeenCalled();
    screen.unmount();
    expect(registerBack).toHaveBeenLastCalledWith(null);
  });

  it('plays an upload with no bundled analysis and asks for its package', async () => {
    const fetchMock = globalThis.fetch as jest.Mock;
    fetchMock.mockClear();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const ep = uploadEpisode({
      mediaId: '01JUPLOAD00000000000000000',
      title: 'Kitchen podcast',
      status: 'ANALYSING',
      playable: true,
      mediaUrl: 'https://d1.cloudfront.net/media/01JUPLOAD.frag.mp4',
    })!;
    const screen = render(
      <Player episode={ep} onExit={jest.fn()} registerBack={jest.fn()} />,
    );
    expect(screen.getByText('From Your Phone · Upload')).toBeTruthy();
    expect(screen.getByText('Kitchen podcast')).toBeTruthy();
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls).toContain(
      'https://d1874v8g2yry52.cloudfront.net/packages/01JUPLOAD00000000000000000/latest.json',
    );
    screen.unmount();
    jest.restoreAllMocks();
  });
});

describe('Player scrubbing', () => {
  it('steps a twentieth of the episode, 2 to 10 seconds', () => {
    expect(stepFor(37)).toBe(2000);
    expect(stepFor(120)).toBe(6000);
    expect(stepFor(3600)).toBe(10000);
  });

  it('holds the thumb while scrubbing and labels it with the time only', () => {
    const screen = render(
      <Player episode={EPISODES[0]} onExit={jest.fn()} registerBack={jest.fn()} />,
    );
    const bar = () => screen.getByTestId('seekbar');
    expect(bar().props.displayAboveThumb).toBeUndefined();
    const start = bar().props.currentValue;
    act(() => {
      bar().props.onSlidingStart();
      bar().props.onValueChange(start + 20000);
    });
    // Frozen where the scrub began, whatever the clock does meanwhile.
    expect(bar().props.currentValue).toBe(start);
    const label = render(bar().props.displayAboveThumb());
    expect(label.getByText('0:20')).toBeTruthy();
    expect(label.toJSON()).toBeTruthy();
    screen.unmount();
  });
});
