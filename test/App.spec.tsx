import 'react-native';
import {render} from '@testing-library/react-native';
import * as React from 'react';

import {App} from '../src/App';

describe('App', () => {
  it('renders the root screen', () => {
    const screen = render(<App />);
    expect(screen.getByText('StudioX Playground')).toBeTruthy();
  });
});
