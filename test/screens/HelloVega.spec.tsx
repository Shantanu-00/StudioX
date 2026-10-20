import 'react-native';
import {render} from '@testing-library/react-native';
import * as React from 'react';

import {HelloVega} from '../../src/screens/HelloVega';

describe('HelloVega', () => {
  it('matches snapshot', () => {
    const screen = render(<HelloVega />);
    expect(screen).toMatchSnapshot();
  });

  it('renders all tiles', () => {
    const screen = render(<HelloVega />);
    expect(screen.getByTestId('tile-home')).toBeTruthy();
    expect(screen.getByTestId('tile-get-started')).toBeTruthy();
    expect(screen.getByTestId('tile-debug')).toBeTruthy();
    expect(screen.getByTestId('tile-learn-more')).toBeTruthy();
  });
});
