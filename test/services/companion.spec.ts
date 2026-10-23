import {createSession, fetchSnapshot} from '../../src/services/companion';

const reply = (body: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  }) as never;

describe('companion client', () => {
  afterEach(() => jest.restoreAllMocks());

  it('rejects a session whose phone link is not http(s)', async () => {
    jest.spyOn(globalThis, 'fetch').mockImplementation(() =>
      reply({
        id: 'a',
        tvToken: 't',
        kind: 'upload',
        code: 'AAA-BBB',
        phoneUrl: 'javascript:x',
        expiresAt: 1,
      }),
    );
    await expect(createSession('upload')).rejects.toThrow('Malformed session');
  });

  it('rejects unknown statuses and clips long strings', async () => {
    const s = {
      id: 'a',
      tvToken: 't',
      kind: 'upload' as const,
      code: 'A',
      phoneUrl: 'http://x',
      expiresAt: 1,
    };
    jest
      .spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => reply({status: 'hacked'}));
    await expect(fetchSnapshot(s)).rejects.toThrow('Malformed status');

    jest
      .spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() =>
        reply({status: 'linked', device: 'x'.repeat(500)}),
      );
    const snap = await fetchSnapshot(s);
    expect(snap.device).toHaveLength(48);
  });
});
