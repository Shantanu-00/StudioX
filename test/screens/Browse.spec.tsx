import 'react-native';
import {fireEvent, render} from '@testing-library/react-native';
import * as React from 'react';

import {Tab} from '../../src/components/NavRail';
import {Browse} from '../../src/screens/Browse';

describe('Browse', () => {
  const setup = (tab: Tab = 'watch') => {
    const onTab = jest.fn();
    const onPlay = jest.fn();
    const screen = render(
      <Browse
        tab={tab}
        onTab={onTab}
        watchFocus="hero-play"
        onWatchFocus={jest.fn()}
        onPlay={onPlay}
        onMap={jest.fn()}
        onCameo={jest.fn()}
      />,
    );
    return {screen, onTab, onPlay};
  };

  it('shows the nav rail, the Play button and both episode tiles', () => {
    const {screen} = setup();
    [
      'nav-watch',
      'nav-shared',
      'nav-link',
      'hero-play',
      'episode-crime-case104',
      'episode-science-ep42',
    ].forEach((id) => expect(screen.getByTestId(id)).toBeTruthy());
  });

  it('plays the featured episode from the hero and any episode from its tile', () => {
    const {screen, onPlay} = setup();
    fireEvent.press(screen.getByTestId('hero-play'));
    fireEvent.press(screen.getByTestId('episode-science-ep42'));
    expect(onPlay.mock.calls.map((c) => c[0].id)).toEqual([
      'crime-case104',
      'science-ep42',
    ]);
  });

  it('previews a tile in the hero when it gains focus', () => {
    const {screen} = setup();
    fireEvent(screen.getByTestId('episode-science-ep42'), 'focus');
    expect(screen.getByText('The Human Blueprint · Ep. 42')).toBeTruthy();
  });

  it('switches section only on SELECT in the rail', () => {
    const {screen, onTab} = setup();
    fireEvent(screen.getByTestId('nav-shared'), 'focus');
    expect(onTab).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('nav-shared'));
    expect(onTab).toHaveBeenCalledWith('shared');
  });

  it('routes the pair tile and the Shared empty state to Link', () => {
    const {screen, onTab} = setup();
    fireEvent.press(screen.getByTestId('tile-pair'));
    const shared = setup('shared');
    fireEvent.press(shared.screen.getByTestId('shared-open-link'));
    expect(onTab).toHaveBeenCalledWith('link');
    expect(shared.onTab).toHaveBeenCalledWith('link');
  });
});
