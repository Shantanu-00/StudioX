import {AsyncStorage} from '@amazon-devices/react-native-kepler';
import {
  createPairing,
  getPairing,
  linkStore,
  listLinkMedia,
  listMessages,
  resetApiState,
  shareCard,
} from '../../src/services/api';

const SECRET = 'S3cretS3cretS3cretS3cret';

interface Init {
  headers?: Record<string, string>;
  body?: string;
}
type Route = (url: string, init: Init) => [number, unknown];

const serve = (route: Route) =>
  jest.spyOn(globalThis, 'fetch').mockImplementation(((
    url: string,
    init: Init,
  ) => {
    const [status, body] = route(String(url), init);
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    });
  }) as never);

const api = (path: string) => `https://d1874v8g2yry52.cloudfront.net/v1${path}`;

describe('AWS client', () => {
  beforeEach(() => {
    resetApiState();
    (AsyncStorage as unknown as {__reset: () => void}).__reset();
  });
  afterEach(() => jest.restoreAllMocks());

  it('registers once, stores the credentials and never logs the secret', async () => {
    const logs: string[] = [];
    (['log', 'info', 'warn', 'error'] as const).forEach((k) =>
      jest
        .spyOn(console, k)
        .mockImplementation((...a: unknown[]) => logs.push(a.join(' '))),
    );
    const fetchMock = serve((url, init) => {
      if (url === api('/devices')) {
        return [201, {deviceId: 'dev_abcdefgh', deviceSecret: SECRET}];
      }
      if (url === api('/pairings')) {
        expect(init.headers?.Authorization).toBe(
          `Device dev_abcdefgh:${SECRET}`,
        );
        return [
          200,
          {
            code: 'K7Q4XZ',
            url: 'https://d1874v8g2yry52.cloudfront.net/link/p/K7Q4XZ',
            expiresAt: '2026-10-22T12:00:00Z',
          },
        ];
      }
      return [404, {}];
    });

    const p = await createPairing();
    expect(p.code).toBe('K7Q4XZ');
    expect(p.expiresAt).toBe(Date.parse('2026-10-22T12:00:00Z'));
    await createPairing();
    const deviceCalls = fetchMock.mock.calls.filter(
      ([u]) => String(u) === api('/devices'),
    );
    expect(deviceCalls).toHaveLength(1);
    expect(await AsyncStorage.getItem('studiox.device.v1')).toContain(SECRET);
    expect(logs.join('\n')).not.toContain(SECRET);
  });

  it('rejects a pairing whose QR link is not https', async () => {
    serve((url) =>
      url === api('/devices')
        ? [201, {deviceId: 'dev_abcdefgh', deviceSecret: SECRET}]
        : [
            200,
            {
              code: 'K7Q4XZ',
              url: 'javascript:x',
              expiresAt: '2026-10-22T12:00:00Z',
            },
          ],
    );
    await expect(createPairing()).rejects.toThrow('Malformed pairing');
  });

  it('reads a linked pairing and shares a card on that link', async () => {
    const bodies: unknown[] = [];
    serve((url, init) => {
      if (url === api('/devices')) {
        return [201, {deviceId: 'dev_abcdefgh', deviceSecret: SECRET}];
      }
      if (url === api('/pairings/K7Q4XZ')) {
        return [
          200,
          {
            status: 'linked',
            linkId: '01JABCDEFGHJKMNPQRSTVWXYZ0',
            phoneName: "Ari's phone",
          },
        ];
      }
      bodies.push(JSON.parse(String(init.body)));
      return [201, {id: 'm1'}];
    });
    const s = await getPairing('K7Q4XZ');
    expect(s).toEqual({
      status: 'linked',
      linkId: '01JABCDEFGHJKMNPQRSTVWXYZ0',
      phoneName: "Ari's phone",
    });
    await shareCard(
      '01JABCDEFGHJKMNPQRSTVWXYZ0',
      {type: 'checklist', title: 'Evening', items: [{text: 'Cool the room'}]},
      {mediaId: 'science-ep42', t: 19},
    );
    expect(bodies[0]).toEqual({
      kind: 'share',
      card: {
        type: 'checklist',
        title: 'Evening',
        items: [{text: 'Cool the room'}],
      },
      mediaId: 'science-ep42',
      t: 19,
    });
  });

  it('forgets the link when the server says it is gone', async () => {
    serve((url) =>
      url === api('/devices')
        ? [201, {deviceId: 'dev_abcdefgh', deviceSecret: SECRET}]
        : [403, {error: {code: 'forbidden'}}],
    );
    await linkStore.set({linkId: '01JABCDEFGHJKMNPQRSTVWXYZ0', phoneName: 'P'});
    await expect(
      shareCard(
        '01JABCDEFGHJKMNPQRSTVWXYZ0',
        {type: 'list', title: 'T', items: [{name: 'a', detail: 'b'}]},
        {mediaId: 'science-ep42', t: 1},
      ),
    ).rejects.toThrow('HTTP 403');
    expect(linkStore.get()).toBeNull();
  });

  it('follows full message pages to the newest and keeps the last cursor', async () => {
    const LINK = '01JABCDEFGHJKMNPQRSTVWXYZ0';
    const page = (from: number, n: number) =>
      Array.from({length: n}, (_, i) => {
        const k = String(from + i).padStart(4, '0');
        return {
          id: `01JMSG${k}00000000000000`,
          at: `2026-10-22T10:00:00Z`,
          from: {kind: 'phone', name: 'P'},
          kind: 'text',
          text: `m${k}`,
        };
      });
    const urls: string[] = [];
    serve((url) => {
      if (url === api('/devices')) {
        return [201, {deviceId: 'dev_abcdefgh', deviceSecret: SECRET}];
      }
      urls.push(url);
      const after = /after=([^&]+)/.exec(url)?.[1];
      const msgs = !after ? page(0, 50) : page(50, 10);
      return [200, {messages: msgs, cursor: msgs[msgs.length - 1].id}];
    });
    const r = await listMessages(LINK, undefined);
    expect(urls).toEqual([
      api(`/links/${LINK}/messages`),
      api(`/links/${LINK}/messages?after=01JMSG004900000000000000`),
    ]);
    expect(r.messages).toHaveLength(50); // the newest 50 of 60
    expect(r.messages[49].text).toBe('m0059');
    expect(r.cursor).toBe('01JMSG005900000000000000');
  });

  it('keeps the link when the new media route answers 404', async () => {
    const LINK = '01JABCDEFGHJKMNPQRSTVWXYZ0';
    serve((url) =>
      url === api('/devices')
        ? [201, {deviceId: 'dev_abcdefgh', deviceSecret: SECRET}]
        : [404, {error: {code: 'not_found'}}],
    );
    await linkStore.set({linkId: LINK, phoneName: 'P'});
    await expect(listLinkMedia(LINK)).rejects.toThrow('HTTP 404');
    expect(linkStore.get()?.linkId).toBe(LINK);
    // The thread route is part of contract v1: a 404 there means the link
    // is gone.
    await expect(listMessages(LINK, undefined)).rejects.toThrow('HTTP 404');
    expect(linkStore.get()).toBeNull();
  });
});
