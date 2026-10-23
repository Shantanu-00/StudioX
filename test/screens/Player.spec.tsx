import 'react-native';
import {render} from '@testing-library/react-native';
import * as React from 'react';

import {EPISODES, uploadEpisode} from '../../src/data/episodes';
import {Player} from '../../src/screens/Player';

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
