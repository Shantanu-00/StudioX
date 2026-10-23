import 'react-native';
import {act, render, waitFor} from '@testing-library/react-native';
import * as React from 'react';
import {AsyncStorage} from '@amazon-devices/react-native-kepler';

import {LinkSection} from '../../src/screens/sections/LinkSection';
import {linkStore, resetApiState} from '../../src/services/api';

const api = (path: string) => `https://d1874v8g2yry52.cloudfront.net/v1${path}`;

describe('LinkSection on AWS', () => {
  beforeEach(() => {
    resetApiState();
    (AsyncStorage as unknown as {__reset: () => void}).__reset();
    jest.useFakeTimers();
  });
  afterEach(async () => {
    await linkStore.clear();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('shows the code from POST /v1/pairings and the phone name once linked', async () => {
    let polls = 0;
    jest.spyOn(globalThis, 'fetch').mockImplementation(((url: string) => {
      const u = String(url);
      let body: unknown = {};
      if (u === api('/devices')) {
        body = {
          deviceId: 'dev_abcdefgh',
          deviceSecret: 'S3cretS3cretS3cretS3cret',
        };
      } else if (u === api('/pairings')) {
        body = {
          code: 'K7Q4XZ',
          url: 'https://d1874v8g2yry52.cloudfront.net/link/p/K7Q4XZ',
          expiresAt: new Date(Date.now() + 600000).toISOString(),
        };
      } else if (u === api('/pairings/K7Q4XZ')) {
        polls += 1;
        body =
          polls < 2
            ? {status: 'waiting'}
            : {
                status: 'linked',
                linkId: '01JABCDEFGHJKMNPQRSTVWXYZ0',
                phoneName: "Ari's phone",
              };
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(body),
      });
    }) as never);

    const screen = render(<LinkSection />);
    await waitFor(() => expect(screen.getByText('K7Q-4XZ')).toBeTruthy());
    expect(screen.getByText('Waiting for your phone')).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(1600);
    });
    await waitFor(() =>
      expect(screen.getByText("Linked to Ari's phone")).toBeTruthy(),
    );
    expect(screen.getByText('Linked')).toBeTruthy();
    expect(linkStore.get()?.phoneName).toBe("Ari's phone");
    screen.unmount();
  });
});
