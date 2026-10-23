import {uploadEpisode} from '../../src/data/episodes';
import {
  clockTime,
  mergeMessages,
  Message,
  parseMediaList,
  parseMessage,
  sourceLine,
  statusLine,
  uploadStatusLine,
  visibleMessages,
} from '../../src/services/inbox';

const msg = (id: string, at: string, extra: object = {}) =>
  parseMessage({
    id,
    at,
    from: {kind: 'phone', name: "Ari's phone"},
    kind: 'text',
    text: `message ${id}`,
    ...extra,
  }) as Message;

describe('inbox messages', () => {
  it('reads every message kind from API contract v1', () => {
    const at = '2026-10-22T10:15:02Z';
    const text = parseMessage({
      id: '01JTEXT0000000000000000000',
      at,
      from: {kind: 'phone', name: "Ari's phone"},
      kind: 'text',
      text: 'Hello TV',
    });
    expect(text).toMatchObject({kind: 'text', text: 'Hello TV'});

    const answer = parseMessage({
      id: '01JANSW0000000000000000000',
      at,
      from: {kind: 'ai', name: 'StudioX'},
      kind: 'answer',
      text: 'Probably not.',
      card: {
        type: 'link',
        title: 'Sources',
        sources: [
          {title: 'A study', url: 'https://www.nih.gov/x'},
          {title: 'Insecure', url: 'http://example.com/'},
        ],
      },
    });
    expect(answer?.card?.sources).toEqual([
      {title: 'A study', url: 'https://www.nih.gov/x'},
    ]);
    expect(sourceLine(answer!.card!.sources[0])).toBe('A study · nih.gov');

    const share = parseMessage({
      id: '01JSHAR0000000000000000000',
      at,
      from: {kind: 'tv', name: 'StudioX TV'},
      kind: 'share',
      card: {
        type: 'list',
        title: 'Evening stack',
        items: [{name: 'Apigenin', detail: '50 mg'}, {text: 'Dim the lights'}],
      },
    });
    expect(share?.card?.items).toEqual(['Apigenin · 50 mg', 'Dim the lights']);

    const status = parseMessage({
      id: '01JSTAT0000000000000000000',
      at,
      from: {kind: 'system', name: 'StudioX'},
      kind: 'status',
      mediaId: '01JMEDIA000000000000000000',
      status: {
        mediaId: '01JMEDIA000000000000000000',
        state: 'ANALYSING',
        progress: 0.4,
      },
    });
    expect(status?.status).toEqual({state: 'ANALYSING', progress: 0.4});
  });

  it('drops malformed messages and bounds text', () => {
    expect(parseMessage({id: 'x', kind: 'text'})).toBeNull();
    expect(
      parseMessage({
        id: '01JX000000000000000000000',
        at: '2026-10-22T10:15:02Z',
        from: {kind: 'robot'},
        kind: 'text',
        text: 'hi',
      }),
    ).toBeNull();
    expect(
      parseMessage({
        id: '01JX000000000000000000000',
        at: '2026-10-22T10:15:02Z',
        from: {kind: 'phone'},
        kind: 'text',
      }),
    ).toBeNull(); // nothing to draw
    const long = msg('01JLONG', '2026-10-22T10:15:02Z', {
      text: 'x'.repeat(5000),
    });
    expect(long.text!.length).toBe(600);
    expect(long.from.name).toBe("Ari's phone");
  });

  it('de-duplicates by id, orders oldest to newest and keeps the newest 50', () => {
    const a = msg('01JA', '2026-10-22T10:00:00Z');
    const b = msg('01JB', '2026-10-22T10:01:00Z');
    const merged = mergeMessages([b], [a, b, a]);
    expect(merged.map((m) => m.id)).toEqual(['01JA', '01JB']);
    const many = Array.from({length: 70}, (_, i) =>
      msg(
        `01J${String(i).padStart(3, '0')}`,
        `2026-10-22T10:${String(i % 60).padStart(2, '0')}:00Z`,
      ),
    ).sort((x, y) => (x.at < y.at ? -1 : 1));
    const kept = mergeMessages([], many);
    expect(kept).toHaveLength(50);
    expect(kept[49].at >= kept[0].at).toBe(true);
    // Unchanged input keeps the same array (no re-render).
    expect(mergeMessages(kept, [])).toBe(kept);
  });

  it('draws the newest 20, widened to keep the focused row mounted', () => {
    const held = Array.from({length: 30}, (_, i) =>
      msg(
        `01JM${String(i).padStart(2, '0')}`,
        `2026-10-22T10:${String(i).padStart(2, '0')}:00Z`,
      ),
    );
    expect(visibleMessages(held, null)).toHaveLength(20);
    expect(visibleMessages(held, '01JM05')[0].id).toBe('01JM05');
  });

  it('formats the time as local 24 h', () => {
    const d = new Date('2026-10-22T10:15:02Z');
    const want = `${String(d.getHours()).padStart(2, '0')}:${String(
      d.getMinutes(),
    ).padStart(2, '0')}`;
    expect(clockTime('2026-10-22T10:15:02Z')).toBe(want);
    expect(clockTime('nope')).toBe('--:--');
  });
});

describe('uploads', () => {
  const raw = (status: string, extra: object = {}) => ({
    mediaId: `m-${status.toLowerCase()}`,
    title: `Clip ${status}`,
    status,
    playable: false,
    createdAt: '2026-10-22T10:00:00Z',
    ...extra,
  });

  it('turns each status into a short sentence-case line', () => {
    const list = parseMediaList({
      media: [
        raw('UPLOADING', {progress: 0.64}),
        raw('PROCESSING'),
        raw('ANALYSING'),
        raw('READY'),
        raw('NOT_A_FIT'),
        raw('FAILED'),
        raw('BOGUS'),
      ],
    });
    expect(list.map((m) => uploadStatusLine(m).text)).toEqual([
      'Uploading 64%',
      'Preparing…',
      'Analysing',
      'Ready',
      'Not a fit',
      'Failed',
    ]);
    expect(uploadStatusLine(list[1]).cursor).toBe(false);
    expect(statusLine('READY').tone).toBe('done');
  });

  it('is playable only with an https media URL', () => {
    const [ok, insecure] = parseMediaList({
      media: [
        raw('READY', {
          mediaId: 'a',
          playable: true,
          mediaUrl: 'https://d1.cloudfront.net/media/a.frag.mp4',
          packageUrl: 'https://d1.cloudfront.net/packages/a/latest.json',
        }),
        raw('READY', {
          mediaId: 'b',
          playable: true,
          mediaUrl: 'http://d1.cloudfront.net/media/b.frag.mp4',
        }),
      ],
    });
    expect(ok.playable).toBe(true);
    expect(insecure.playable).toBe(false);
    expect(parseMediaList({nope: 1})).toEqual([]);
  });

  it('builds a dynamic Player episode from a playable upload', () => {
    const [m] = parseMediaList({
      media: [
        raw('ANALYSING', {
          mediaId: '01JUPLOAD00000000000000000',
          title: 'Kitchen podcast',
          playable: true,
          mediaUrl: 'https://d1.cloudfront.net/media/01JUPLOAD.frag.mp4',
        }),
      ],
    });
    const ep = uploadEpisode(m)!;
    expect(ep).toMatchObject({
      id: '01JUPLOAD00000000000000000',
      title: 'Kitchen podcast',
      show: 'FROM YOUR PHONE',
      mediaUrl: 'https://d1.cloudfront.net/media/01JUPLOAD.frag.mp4',
      upload: {status: 'ANALYSING'},
    });
    expect(ep.fallbackMediaUrl).toBeUndefined();
    expect(ep.backdrop).toBeUndefined();
    expect(ep.packageUrl).toBeUndefined();
    expect(uploadEpisode({...m, playable: false})).toBeNull();
  });
});
