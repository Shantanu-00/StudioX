import 'react-native';
import {fireEvent, render} from '@testing-library/react-native';
import * as React from 'react';

import {setBundledPackages} from '../../src/analysis/packageLoader';
import {WatchSection} from '../../src/screens/sections/WatchSection';
import {
  clone,
  financeCameo,
  historyCameo,
  sleepExplore,
} from '../fixtures/explore';

const realBundled = require('../../src/analysis/packages').BUNDLED;

const setup = () => {
  const onMap = jest.fn();
  const onCameo = jest.fn();
  const screen = render(
    <WatchSection
      initialFocus="hero-play"
      onPlay={jest.fn()}
      onMap={onMap}
      onCameo={onCameo}
      onFocusItem={jest.fn()}
      onOpenLink={jest.fn()}
    />,
  );
  return {screen, onMap, onCameo};
};

afterEach(() => setBundledPackages(realBundled));

describe('WatchSection Map entry points', () => {
  it('shows no Map button or maps row when no package has a map', () => {
    setBundledPackages({});
    const {screen} = setup();
    expect(screen.queryByTestId('hero-map')).toBeNull();
    expect(screen.queryByText('More maps')).toBeNull();
  });

  it('shows Map on the hero for an eligible episode, and the cameo row', () => {
    const crime = clone(realBundled['crime-case104']);
    setBundledPackages({
      'crime-case104': {...crime, explore: clone(sleepExplore)},
      'cameo-finance': clone(financeCameo),
      'cameo-history': clone(historyCameo),
    });
    const {screen, onMap, onCameo} = setup();
    fireEvent.press(screen.getByTestId('hero-map'));
    expect(onMap.mock.calls[0][0].id).toBe('crime-case104');
    expect(screen.getByText('More maps')).toBeTruthy();
    expect(screen.getByText('Example transcripts written by StudioX')).toBeTruthy();
    expect(screen.getByText('Start now or start later')).toBeTruthy();
    expect(screen.getByText('History')).toBeTruthy();
    fireEvent.press(screen.getByTestId('cameo-cameo-finance'));
    expect(onCameo).toHaveBeenCalledWith('cameo-finance');
  });

  it('hides Map when the explore block is not eligible', () => {
    const crime = clone(realBundled['crime-case104']);
    setBundledPackages({
      'crime-case104': {...crime, explore: {...clone(sleepExplore), eligible: false}},
    });
    const {screen} = setup();
    expect(screen.queryByTestId('hero-map')).toBeNull();
  });
});
