import 'react-native';
import {act, render} from '@testing-library/react-native';
import * as React from 'react';
import {useTVEventHandler} from '@amazon-devices/react-native-kepler';

import {App} from '../src/App';

describe('App', () => {
  beforeAll(() => jest.useFakeTimers());
  afterAll(() => jest.useRealTimers());

  it('opens on the v5 intro video, and a skip goes Home', () => {
    const screen = render(<App />);
    expect(screen.getByLabelText('StudioX')).toBeTruthy();
    expect(screen.getByTestId('intro-video')).toBeTruthy();

    const calls = (useTVEventHandler as unknown as jest.Mock).mock.calls;
    act(() => {
      calls[calls.length - 1][0]({eventType: 'select', eventKeyAction: 1});
    });
    expect(screen.queryByTestId('intro-video')).toBeNull();
    screen.unmount();
  });
});
