import 'react-native';
import {fireEvent, render} from '@testing-library/react-native';
import * as React from 'react';

import {Playground} from '../../src/screens/Playground';

describe('Playground', () => {
  it('renders every card and the reset button', () => {
    const screen = render(<Playground />);
    ['a', 'b', 'c', 'd', 'e', 'f'].forEach((id) => {
      expect(screen.getByTestId(`card-${id}`)).toBeTruthy();
    });
    expect(screen.getByTestId('reset')).toBeTruthy();
  });

  it('counts presses per card and resets them', () => {
    const screen = render(<Playground />);
    fireEvent.press(screen.getByTestId('card-a'));
    fireEvent.press(screen.getByTestId('card-a'));
    expect(screen.getByLabelText('Alpha, pressed 2 times')).toBeTruthy();
    expect(screen.getByLabelText('Bravo, pressed 0 times')).toBeTruthy();

    fireEvent.press(screen.getByTestId('reset'));
    expect(screen.getByLabelText('Alpha, pressed 0 times')).toBeTruthy();
  });
});
