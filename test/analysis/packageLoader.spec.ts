import {act, renderHook} from '@testing-library/react-native';
import {
  fetchPackage,
  localPackage,
  provenanceLine,
  setBundledPackages,
  usePackage,
} from '../../src/analysis/packageLoader';
import {ANALYSES} from '../../src/analysis/fixtures';

const pipelinePkg = {
  mediaId: 'science-ep42',
  provenance: 'pipeline',
  generatedAt: '2026-10-22T18:00:00Z',
  segments: [],
  moments: [{t: 0, caption: 'From the pipeline'}],
  widgets: [
    {
      id: 'p1',
      type: 'claim',
      claim: 'A claim.',
      speaker: 'Host',
      context: 'Context.',
      verdict: 'SUPPORTED',
      evidence: [{t0: 0, t1: 1}],
    },
  ],
};

const reply = (status: number, body: unknown) =>
  Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  }) as never;

describe('package loading', () => {
  beforeEach(() => {
    setBundledPackages({});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.restoreAllMocks();
    setBundledPackages({});
  });

  it('falls back to the fixture when nothing is bundled', () => {
    const p = localPackage('science-ep42')!;
    expect(p.source).toBe('fixture');
    expect(p.analysis).toBe(ANALYSES['science-ep42']);
  });

  it('prefers a valid bundled package and borrows the fixture transcript', () => {
    setBundledPackages({'science-ep42': pipelinePkg});
    const p = localPackage('science-ep42')!;
    expect(p.source).toBe('bundled');
    expect(p.analysis.widgets.map((w) => w.id)).toEqual(['p1']);
    expect(p.analysis.transcript.length).toBeGreaterThan(0);
  });

  it('ignores a bundled package that fails validation', () => {
    setBundledPackages({'science-ep42': {...pipelinePkg, mediaId: 'other'}});
    expect(localPackage('science-ep42')!.source).toBe('fixture');
  });

  it('returns the CDN package when valid, and null on HTTP errors or bad JSON', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch');
    fetchMock.mockImplementationOnce(() => reply(200, pipelinePkg));
    expect((await fetchPackage('science-ep42'))?.provenance).toBe('pipeline');
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'https://d1874v8g2yry52.cloudfront.net/packages/science-ep42/latest.json',
    );

    fetchMock.mockImplementationOnce(() => reply(403, {}));
    expect(await fetchPackage('science-ep42')).toBeNull();

    fetchMock.mockImplementationOnce(() =>
      reply(200, {mediaId: 'science-ep42'}),
    );
    expect(await fetchPackage('science-ep42')).toBeNull();
  });

  it('states provenance honestly', () => {
    expect(provenanceLine(ANALYSES['science-ep42'])).toBe(
      'Demo analysis from the episode script',
    );
    setBundledPackages({'science-ep42': pipelinePkg});
    expect(provenanceLine(localPackage('science-ep42')!.analysis)).toBe(
      'Analysed by StudioX · 22 Oct',
    );
  });
});

describe('upload packages (no bundled package)', () => {
  const ID = '01JUPLOAD00000000000000000';
  const URL = `https://d1874v8g2yry52.cloudfront.net/packages/${ID}/latest.json`;
  const uploadPkg = {...pipelinePkg, mediaId: ID};
  const advance = (ms: number) =>
    act(async () => {
      jest.advanceTimersByTime(ms);
    });

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    // The bundled demo package must never stand in for an upload.
    setBundledPackages({[ID]: uploadPkg});
    // `fetch` is the setup's jest.fn: spyOn returns it, so clear old calls.
    (globalThis.fetch as jest.Mock).mockClear();
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    setBundledPackages({});
  });

  it('starts empty and pending, refetches every 10 s and stops once it arrives', async () => {
    let ready = false;
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() =>
        ready ? reply(200, uploadPkg) : reply(403, {}),
      );
    const {result, unmount} = renderHook(() =>
      usePackage(ID, {url: URL, expected: true}),
    );
    expect(result.current.source).toBe('pending');
    expect(result.current.analysis.widgets).toEqual([]);
    await advance(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(URL);

    await advance(10000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.source).toBe('pending');

    ready = true;
    await advance(10000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.current.source).toBe('cdn');
    expect(result.current.analysis.widgets.map((w) => w.id)).toEqual(['p1']);

    await advance(60000);
    expect(fetchMock).toHaveBeenCalledTimes(3); // stopped when READY
    unmount();
  });

  it('gives up after 10 minutes', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => reply(404, {}));
    const {result, unmount} = renderHook(() =>
      usePackage(ID, {expected: true}),
    );
    for (let i = 0; i < 61; i++) {
      await advance(10000);
    }
    expect(result.current.source).toBe('none');
    const calls = fetchMock.mock.calls.length;
    expect(calls).toBeLessThanOrEqual(62);
    await advance(60000);
    expect(fetchMock.mock.calls.length).toBe(calls);
    unmount();
  });

  it('does not wait when the pipeline ended without a package', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch');
    const {result, unmount} = renderHook(() =>
      usePackage(ID, {expected: false}),
    );
    await advance(30000);
    expect(result.current.source).toBe('none');
    expect(fetchMock).not.toHaveBeenCalled();
    unmount();
  });
});

describe('isOlder', () => {
  it('keeps the newest analysis: an older CDN copy does not replace the bundled one', () => {
    const {isOlder} = require('../../src/analysis/packageLoader');
    const at = (generatedAt?: string) => ({
      mediaId: 'x',
      provenance: 'pipeline',
      transcript: [],
      segments: [],
      moments: [],
      widgets: [],
      generatedAt,
    });
    expect(isOlder(at('2026-10-22T20:16:15Z'), at('2026-10-22T23:13:25Z'))).toBe(true);
    expect(isOlder(at('2026-10-23T01:00:00Z'), at('2026-10-22T23:13:25Z'))).toBe(false);
    expect(isOlder(at(undefined), at('2026-10-22T23:13:25Z'))).toBe(false);
  });
});
