import 'react-native';
import {render} from '@testing-library/react-native';
import * as React from 'react';

import {App} from '../src/App';

describe('App', () => {
  it('opens on the intro sting', () => {
    const screen = render(<App />);
    expect(screen.getByText('Press OK to skip')).toBeTruthy();
  });
});
