import 'react-native';
import {act, fireEvent, render} from '@testing-library/react-native';
import * as React from 'react';
import {AsyncStorage} from '@amazon-devices/react-native-kepler';

import {resetInboxCache} from '../../src/hooks/useLinkInbox';
import {
  resetSharedFocus,
  SharedSection,
} from '../../src/screens/sections/SharedSection';
import {
  linkStore,
  listLinkMedia,
  listMessages,
  resetApiState,
} from '../../src/services/api';
import {parseMediaList, parseMessage} from '../../src/services/inbox';

jest.mock('../../src/services/api', () => ({
  ...jest.requireActual('../../src/services/api'),
  listMessages: jest.fn(),
  listLinkMedia: jest.fn(),
}));

const LINK = '01JLINK0000000000000000000';
const MEDIA = '01JMEDIA000000000000000000';
const AT = '2026-10-22T10:15:02Z';

const thread = [
  {
    id: '01JM01',
    at: AT,
    from: {kind: 'phone', name: "Ari's phone"},
    kind: 'question',
    text: 'Is the 37% real?',
  },
  {
    id: '01JM02',
    at: AT,
    from: {kind: 'ai', name: 'StudioX'},
    kind: 'answer',
    text: 'It comes from one small study.',
    card: {
      type: 'link',
      title: 'Sources',
      sources: [{title: 'Sleep study', url: 'https://www.nih.gov/a'}],
    },
  },
  {
    id: '01JM03',
    at: AT,
    from: {kind: 'tv', name: 'StudioX TV'},
    kind: 'share',
    card: {
      type: 'checklist',
      title: 'Evening routine',
      items: [{text: 'Cool the room'}, {text: 'Dim lights'}],
    },
  },
  {
    id: '01JM04',
    at: AT,
    from: {kind: 'system', name: 'StudioX'},
    kind: 'status',
    mediaId: MEDIA,
    status: {mediaId: MEDIA, state: 'ANALYSING', progress: 0.4},
  },
  {
    id: '01JM05',
    at: AT,
    from: {kind: 'phone', name: "Ari's phone"},
    kind: 'text',
    text: 'Hello TV',
  },
].map((m) => parseMessage(m)!);

const media = parseMediaList({
  media: [
    {
      mediaId: MEDIA,
      title: 'Kitchen podcast',
      status: 'ANALYSING',
      playable: true,
      mediaUrl: `https://d1.cloudfront.net/media/${MEDIA}.frag.mp4`,
    },
    {
      mediaId: 'm-up',
      title: 'Big file',
      status: 'UPLOADING',
      progress: 0.64,
      playable: false,
    },
    {
      mediaId: 'm-fit',
      title: 'Music video',
      status: 'NOT_A_FIT',
      playable: false,
    },
  ],
});

describe('SharedSection (TV inbox)', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    resetApiState();
    resetInboxCache();
    resetSharedFocus();
    (AsyncStorage as unknown as {__reset: () => void}).__reset();
    (listMessages as jest.Mock).mockReset();
    (listLinkMedia as jest.Mock).mockReset();
  });
  afterEach(async () => {
    await linkStore.clear();
    jest.useRealTimers();
  });

  it('keeps the Link a phone empty state when not paired', () => {
    const onOpenLink = jest.fn();
    const screen = render(
      <SharedSection onOpenLink={onOpenLink} onPlay={jest.fn()} />,
    );
    fireEvent.press(screen.getByTestId('shared-open-link'));
    expect(onOpenLink).toHaveBeenCalled();
    expect(listMessages).not.toHaveBeenCalled();
  });

  it('draws every message kind and the uploads row when paired', async () => {
    (listMessages as jest.Mock).mockResolvedValue({
      messages: thread,
      cursor: '01JM05',
    });
    (listLinkMedia as jest.Mock).mockResolvedValue(media);
    await linkStore.set({linkId: LINK, phoneName: "Ari's phone"});
    const onPlay = jest.fn();
    const screen = render(
      <SharedSection onOpenLink={jest.fn()} onPlay={onPlay} />,
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText("Linked to Ari's phone")).toBeTruthy();
    // Thread.
    expect(screen.getByText('Is the 37% real?')).toBeTruthy();
    expect(screen.getByText('It comes from one small study.')).toBeTruthy();
    expect(screen.getByText('Sleep study · nih.gov')).toBeTruthy();
    expect(screen.getByText('Evening routine')).toBeTruthy();
    expect(screen.getByText('Checklist')).toBeTruthy();
    expect(screen.getByText('Cool the room')).toBeTruthy();
    expect(screen.getByText(/ · Analysing · Kitchen podcast$/)).toBeTruthy();
    expect(screen.getByText('Hello TV')).toBeTruthy();
    expect(
      screen.getByText(/^Ari's phone · \d\d:\d\d · Question$/),
    ).toBeTruthy();
    // Uploads.
    expect(screen.getByTestId(`upload-status-${MEDIA}`)).toHaveTextContent(
      'Analysing',
    );
    expect(screen.getByTestId('upload-status-m-up')).toHaveTextContent(
      'Uploading 64%',
    );
    expect(screen.getByTestId('upload-status-m-fit')).toHaveTextContent(
      'Not a fit',
    );
    expect(screen.getByTestId(`upload-play-${MEDIA}`)).toBeTruthy();
    expect(screen.queryByTestId('upload-play-m-up')).toBeNull();

    // SELECT: only a playable upload opens the Player.
    fireEvent.press(screen.getByTestId('upload-m-up'));
    expect(onPlay).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId(`upload-${MEDIA}`));
    expect(onPlay).toHaveBeenCalledWith(
      expect.objectContaining({
        id: MEDIA,
        title: 'Kitchen podcast',
        show: 'FROM YOUR PHONE',
        upload: {status: 'ANALYSING'},
      }),
    );
    screen.unmount();
  });

  it('gives initial focus to the newest upload, and restores the last row', async () => {
    (listMessages as jest.Mock).mockResolvedValue({
      messages: thread,
      cursor: '01JM05',
    });
    (listLinkMedia as jest.Mock).mockResolvedValue(media);
    await linkStore.set({linkId: LINK, phoneName: "Ari's phone"});
    const first = render(
      <SharedSection onOpenLink={jest.fn()} onPlay={jest.fn()} />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(first.getByTestId(`upload-${MEDIA}`).props.hasTVPreferredFocus).toBe(
      true,
    );
    fireEvent(first.getByTestId('message-01JM02'), 'focus');
    first.unmount();

    // Back from the Player: drawn from the cache at once, focus restored.
    const again = render(
      <SharedSection onOpenLink={jest.fn()} onPlay={jest.fn()} />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(again.getByTestId('message-01JM02').props.hasTVPreferredFocus).toBe(
      true,
    );
    expect(
      again.getByTestId(`upload-${MEDIA}`).props.hasTVPreferredFocus,
    ).toBeFalsy();
    again.unmount();
  });

  it('says so when the uploads route is not there yet', async () => {
    (listMessages as jest.Mock).mockResolvedValue({
      messages: [],
      cursor: undefined,
    });
    (listLinkMedia as jest.Mock).mockRejectedValue(new Error('HTTP 404'));
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    await linkStore.set({linkId: LINK, phoneName: 'P'});
    const screen = render(
      <SharedSection onOpenLink={jest.fn()} onPlay={jest.fn()} />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      screen.getByText('Uploads are not available right now.'),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'No messages yet. Ask about what is playing from your phone.',
      ),
    ).toBeTruthy();
    screen.unmount();
  });
});
