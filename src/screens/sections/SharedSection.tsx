import React, {useCallback, useMemo, useRef, useState} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {TVFocusGuideView} from '@amazon-devices/react-native-kepler';
import {FocusFrame} from '../../components/FocusFrame';
import {Icon} from '../../components/Icon';
import {Episode, uploadEpisode} from '../../data/episodes';
import {useLink} from '../../hooks/useLink';
import {InboxState, useLinkInbox} from '../../hooks/useLinkInbox';
import {Link} from '../../services/api';
import {
  clockTime,
  LinkMedia,
  Message,
  sourceLine,
  StatusLine,
  statusLine,
  uploadStatusLine,
  visibleMessages,
} from '../../services/inbox';
import {displayCase} from '../../analysis/cardText';
import {colors, numeric, space, type} from '../../theme';

interface Props {
  onOpenLink: () => void;
  onPlay: (episode: Episode) => void;
}

type FocusKey = {area: 'upload' | 'message'; id: string};

// Survives the section unmounting (opening the Player, switching section),
// so focus comes back to the row the viewer left.
let lastFocus: FocusKey | null = null;

// For tests.
export function resetSharedFocus() {
  lastFocus = null;
}

// "Shared with you": the TV inbox. Not paired, it points to pairing. Paired,
// it shows the phone's uploads (a row) above the link's thread (a column).
export const SharedSection = ({onOpenLink, onPlay}: Props) => {
  const link = useLink();
  return (
    <View style={styles.root}>
      {link ? (
        <Inbox link={link} onPlay={onPlay} />
      ) : (
        <>
          <Text style={styles.pageTitle}>Shared with you</Text>
          <Unpaired onOpenLink={onOpenLink} />
        </>
      )}
    </View>
  );
};

const Unpaired = ({onOpenLink}: {onOpenLink: () => void}) => (
  <View style={styles.empty}>
    <Icon name="shared" size={40} color={colors.textTertiary} />
    <Text style={styles.emptyTitle}>Nothing shared yet</Text>
    <Text style={styles.emptyBody}>
      Videos, links and messages sent from a linked phone appear here.
    </Text>
    <FocusFrame
      testID="shared-open-link"
      accessibilityLabel="Link a phone"
      variant="button"
      hasTVPreferredFocus
      style={styles.buttonWrap}
      contentStyle={styles.button}
      onPress={onOpenLink}>
      {(focused) => (
        <>
          <Icon
            name="phone"
            size={20}
            color={focused ? colors.onFocus : colors.text}
          />
          <Text
            style={[styles.buttonText, focused && styles.buttonTextFocused]}>
            Link a phone
          </Text>
        </>
      )}
    </FocusFrame>
  </View>
);

// Where focus lands when the inbox first has content: the row left last
// time, else the newest upload, else the newest message.
function pickInitial(
  inbox: InboxState,
  rows: Message[],
  saved: FocusKey | null,
): FocusKey | null {
  if (
    saved &&
    (saved.area === 'upload'
      ? inbox.media.some((m) => m.mediaId === saved.id)
      : rows.some((m) => m.id === saved.id))
  ) {
    return saved;
  }
  if (inbox.media.length > 0) {
    return {area: 'upload', id: inbox.media[0].mediaId};
  }
  const newest = rows[rows.length - 1];
  return newest ? {area: 'message', id: newest.id} : null;
}

const Inbox = ({
  link,
  onPlay,
}: {
  link: Link;
  onPlay: (episode: Episode) => void;
}) => {
  const inbox = useLinkInbox(link.linkId);
  const [focusedMsg, setFocusedMsg] = useState<string | null>(
    lastFocus?.area === 'message' ? lastFocus.id : null,
  );
  const [lastUpload, setLastUpload] = useState<string | null>(
    lastFocus?.area === 'upload' ? lastFocus.id : null,
  );
  const rows = useMemo(
    () => visibleMessages(inbox.messages, focusedMsg),
    [inbox.messages, focusedMsg],
  );
  const newestId = rows[rows.length - 1]?.id ?? null;

  // Decided once, in the render that first has content, so the target
  // mounts with hasTVPreferredFocus already set; dropped as soon as that
  // element has focus, so rows arriving later can never steal it.
  const initial = useRef<FocusKey | null | undefined>(undefined);
  const loaded = inbox.thread !== 'loading' || inbox.uploads !== 'loading';
  if (initial.current === undefined && loaded) {
    initial.current = pickInitial(inbox, rows, lastFocus);
  }
  const isInitial = (area: FocusKey['area'], id: string) =>
    !!initial.current &&
    initial.current.area === area &&
    initial.current.id === id;
  const consumeInitial = () => {
    initial.current = null;
  };

  // Entering an area from outside lands on its remembered row.
  const [uploadNode, setUploadNode] = useState<View | null>(null);
  const [messageNode, setMessageNode] = useState<View | null>(null);
  const uploadTarget =
    lastUpload && inbox.media.some((m) => m.mediaId === lastUpload)
      ? lastUpload
      : inbox.media[0]?.mediaId ?? null;
  const messageTarget =
    focusedMsg && rows.some((m) => m.id === focusedMsg) ? focusedMsg : newestId;

  const titles = useMemo(
    () => new Map(inbox.media.map((m) => [m.mediaId, m.title])),
    [inbox.media],
  );

  return (
    <>
      <View style={styles.header}>
        <Text style={styles.pageTitle}>Shared with you</Text>
        <View style={styles.linkState}>
          <View
            style={[
              styles.dot,
              inbox.thread === 'ok' ? styles.dotLive : styles.dotIdle,
            ]}
          />
          <Text style={styles.linkText}>
            {inbox.thread === 'error'
              ? 'Can’t reach StudioX · retrying'
              : `Linked to ${link.phoneName}`}
          </Text>
        </View>
      </View>

      <Text style={styles.areaTitle}>Uploads</Text>
      {inbox.media.length > 0 ? (
        <TVFocusGuideView
          destinations={uploadNode ? [uploadNode] : undefined}
          trapFocusRight
          style={styles.uploadsGuide}>
          <ScrollView
            horizontal
            style={styles.uploadsScroll}
            contentContainerStyle={styles.uploadsContent}
            showsHorizontalScrollIndicator={false}>
            {inbox.media.map((m) => (
              <UploadTile
                key={m.mediaId}
                media={m}
                ref={m.mediaId === uploadTarget ? setUploadNode : undefined}
                preferred={isInitial('upload', m.mediaId)}
                onFocus={() => {
                  lastFocus = {area: 'upload', id: m.mediaId};
                  setLastUpload(m.mediaId);
                  setFocusedMsg(null);
                  consumeInitial();
                }}
                onPress={() => {
                  const ep = uploadEpisode(m);
                  if (ep) {
                    onPlay(ep);
                  }
                }}
              />
            ))}
          </ScrollView>
        </TVFocusGuideView>
      ) : (
        <Text style={styles.areaNote}>
          {inbox.uploads === 'loading'
            ? 'Loading…'
            : inbox.uploads === 'unavailable'
            ? 'Uploads are not available right now.'
            : 'No uploads yet. Upload a video from StudioX Link on your phone.'}
        </Text>
      )}

      <Text style={[styles.areaTitle, styles.threadTitle]}>Messages</Text>
      {rows.length > 0 ? (
        <Thread
          rows={rows}
          newestId={newestId}
          focusedId={focusedMsg}
          titles={titles}
          targetId={messageTarget}
          targetRef={setMessageNode}
          target={messageNode}
          isInitial={(id) => isInitial('message', id)}
          onFocusRow={(id) => {
            lastFocus = {area: 'message', id};
            setFocusedMsg(id);
            consumeInitial();
          }}
        />
      ) : (
        <Text style={styles.areaNote}>
          {inbox.thread === 'loading'
            ? 'Loading…'
            : inbox.thread === 'error'
            ? 'Can’t reach StudioX. Retrying.'
            : 'No messages yet. Ask about what is playing from your phone.'}
        </Text>
      )}
    </>
  );
};

// ---- uploads ---------------------------------------------------------------------

const TILE_W = 144;
const TILE_H = 81; // 16:9

const toneStyle = (tone: StatusLine['tone']) =>
  tone === 'done'
    ? styles.toneDone
    : tone === 'dead'
    ? styles.toneDead
    : styles.toneLive;

// Art is a quiet placeholder (a play glyph when ready): the card scales on
// focus, so all text sits below it, unscaled.
const UploadTile = React.forwardRef<
  View,
  {
    media: LinkMedia;
    preferred: boolean;
    onFocus: () => void;
    onPress: () => void;
  }
>(({media, preferred, onFocus, onPress}, ref) => {
  const [focused, setFocused] = useState(false);
  const line = uploadStatusLine(media);
  const progress =
    media.status === 'UPLOADING' && media.progress !== undefined
      ? Math.round((TILE_W - 28) * media.progress)
      : null;
  return (
    <View style={styles.tile}>
      <FocusFrame
        ref={ref}
        testID={`upload-${media.mediaId}`}
        accessibilityLabel={`${media.title}. ${line.text}. ${
          media.playable ? 'Select to play.' : 'Not ready to play.'
        }`}
        variant="card"
        hasTVPreferredFocus={preferred}
        contentStyle={styles.tileArt}
        onFocus={() => {
          setFocused(true);
          onFocus();
        }}
        onBlur={() => setFocused(false)}
        onPress={onPress}>
        {() => (
          <>
            {media.playable ? (
              <View
                style={styles.playGlyph}
                testID={`upload-play-${media.mediaId}`}>
                <Icon name="play" size={28} color={colors.text} />
              </View>
            ) : null}
            {progress !== null ? (
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, {width: progress}]} />
              </View>
            ) : null}
          </>
        )}
      </FocusFrame>
      <Text
        style={[styles.tileTitle, focused && styles.tileTitleOn]}>
        {media.title}
      </Text>
      <StatusText line={line} testID={`upload-status-${media.mediaId}`} />
    </View>
  );
});

const StatusText = ({line, testID}: {line: StatusLine; testID?: string}) => (
  <View style={styles.statusRow}>
    <Text
      testID={testID}
      style={[styles.statusText, toneStyle(line.tone)]}>
      {line.text}
    </Text>
  </View>
);

// ---- thread ----------------------------------------------------------------------

const Thread = ({
  rows,
  newestId,
  focusedId,
  titles,
  targetId,
  targetRef,
  target,
  isInitial,
  onFocusRow,
}: {
  rows: Message[];
  newestId: string | null;
  focusedId: string | null;
  titles: Map<string, string>;
  targetId: string | null;
  targetRef: (v: View | null) => void;
  target: View | null;
  isInitial: (id: string) => boolean;
  onFocusRow: (id: string) => void;
}) => {
  const scroll = useRef<ScrollView>(null);
  // Follow new messages only while the viewer is not reading older ones.
  const follow = useRef(true);
  follow.current = !focusedId || focusedId === newestId;
  const onSize = useCallback(() => {
    if (follow.current) {
      scroll.current?.scrollToEnd({animated: false});
    }
  }, []);

  return (
    <TVFocusGuideView
      destinations={target ? [target] : undefined}
      trapFocusDown
      trapFocusRight
      style={styles.threadGuide}>
      <ScrollView
        ref={scroll}
        style={styles.threadScroll}
        contentContainerStyle={styles.threadContent}
        showsVerticalScrollIndicator={false}
        onContentSizeChange={onSize}>
        {rows.map((m) => (
          <View
            key={m.id}
            accessibilityLiveRegion={m.id === newestId ? 'polite' : 'none'}>
            <MessageRow
              m={m}
              title={m.mediaId ? titles.get(m.mediaId) : undefined}
              ref={m.id === targetId ? targetRef : undefined}
              preferred={isInitial(m.id)}
              onFocus={() => onFocusRow(m.id)}
            />
          </View>
        ))}
      </ScrollView>
    </TVFocusGuideView>
  );
};

const KIND_TAG: Partial<Record<Message['kind'], string>> = {
  question: 'Question',
  answer: 'Answer',
  share: 'Sent to phone',
};

const rowLabel = (m: Message, title?: string) => {
  if (m.kind === 'status') {
    const st = m.status ? statusLine(m.status.state, m.status.progress) : null;
    return [m.text ?? st?.text, title].filter(Boolean).join(' · ');
  }
  const parts = [m.from.name, m.text, m.card?.title].filter(Boolean);
  return parts.join('. ');
};

// Every message is one full-width focusable row, so the D-pad moves through
// the thread in a straight line; the content inside sits right for the
// phone and left for the TV, the AI and the system.
const MessageRow = React.forwardRef<
  View,
  {m: Message; title?: string; preferred: boolean; onFocus: () => void}
>(({m, title, preferred, onFocus}, ref) => {
  const mine = m.from.kind === 'phone';
  const label = rowLabel(m, title);
  return (
    <FocusFrame
      ref={ref}
      testID={`message-${m.id}`}
      accessibilityLabel={label}
      variant="row"
      hasTVPreferredFocus={preferred}
      style={[styles.rowWrap, mine && styles.rowMine]}
      contentStyle={
        m.kind === 'status'
          ? styles.statusRowInner
          : [styles.bubble, mine ? styles.mine : styles.theirs]
      }
      onFocus={onFocus}>
      {(focused) =>
        m.kind === 'status' ? (
          <StatusMessage m={m} title={title} focused={focused} />
        ) : (
          <>
            <Text
              style={[
                styles.sender,
                mine && styles.senderMine,
                focused && styles.onFocusDim,
              ]}>
              {[m.from.name, clockTime(m.at), KIND_TAG[m.kind]]
                .filter(Boolean)
                .join(' · ')}
            </Text>
            {m.text ? (
              <Text
                style={[
                  styles.body,
                  mine && styles.bodyMine,
                  focused && styles.onFocus,
                ]}>
                {m.text}
              </Text>
            ) : null}
            {m.kind === 'share' && m.card ? (
              <ShareCard m={m} focused={focused} />
            ) : null}
            {m.kind !== 'share' && m.card?.sources.length
              ? m.card.sources.map((s) => (
                  <Text
                    key={s.url}
                    style={[styles.source, focused && styles.onFocusDim]}>
                    {sourceLine(s)}
                  </Text>
                ))
              : null}
          </>
        )
      }
    </FocusFrame>
  );
});

const StatusMessage = ({
  m,
  title,
  focused,
}: {
  m: Message;
  title?: string;
  focused: boolean;
}) => {
  const st = m.status ? statusLine(m.status.state, m.status.progress) : null;
  const text = [clockTime(m.at), m.text ?? st?.text, title]
    .filter(Boolean)
    .join(' · ');
  return (
    <Text
      style={[
        styles.statusLine,
        st ? toneStyle(st.tone) : styles.toneLive,
        focused && styles.onFocus,
      ]}>
      {text}
    </Text>
  );
};

const ShareCard = ({m, focused}: {m: Message; focused: boolean}) => {
  const card = m.card!;
  const shown = card.items.slice(0, 3);
  const more = card.items.length - shown.length;
  return (
    <View style={styles.share}>
      <Text
        style={[styles.shareType, focused && styles.onFocusDim]}>
        {displayCase(card.type.toUpperCase())}
      </Text>
      <Text
        style={[styles.shareTitle, focused && styles.onFocus]}>
        {card.title}
      </Text>
      {shown.map((item, i) => (
        <Text
          key={`${i}-${item}`}
          style={[styles.shareItem, focused && styles.onFocusDim]}>
          {item}
        </Text>
      ))}
      {more > 0 ? (
        <Text
          style={[styles.shareMore, focused && styles.onFocusDim]}>
          {`${more} more`}
        </Text>
      ) : null}
    </View>
  );
};

// ---- styles ----------------------------------------------------------------------
// 960 × 540 dp canvas. Content runs from x = 96 (right of the rail) to the
// 48 dp safe margin; the thread takes whatever height is left to the 27 dp
// bottom margin, so nothing depends on one canvas size.

const BUBBLE_MAX = 560;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingLeft: space.content,
    paddingRight: space.safeX,
    paddingTop: space.safeY + 18,
    paddingBottom: space.safeY,
  },
  header: {flexDirection: 'row', alignItems: 'center'},
  pageTitle: {...type.title, color: colors.text, flexShrink: 0},
  linkState: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginLeft: 24,
  },
  dot: {width: 8, height: 8, borderRadius: 4, marginRight: 8},
  dotLive: {backgroundColor: colors.text},
  dotIdle: {backgroundColor: colors.textTertiary},
  linkText: {
    ...type.caption,
    ...numeric,
    color: colors.textSecondary,
    flexShrink: 1,
  },

  areaTitle: {...type.headline, color: colors.text, marginTop: 16},
  threadTitle: {marginTop: 8},
  areaNote: {
    ...type.body,
    color: colors.textTertiary,
    marginTop: 8,
    marginBottom: 8,
  },

  // Uploads row. The scroll view is pulled out by its padding so a focused
  // card (scaled 1.08) is never clipped.
  uploadsGuide: {marginLeft: -space.xs, marginRight: -space.xs},
  uploadsScroll: {flexGrow: 0},
  uploadsContent: {
    paddingHorizontal: space.xs,
    paddingTop: space.xs,
    paddingBottom: 4,
  },
  tile: {width: TILE_W, marginRight: space.l},
  tileArt: {height: TILE_H},
  playGlyph: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressTrack: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 14,
    height: 2,
    backgroundColor: colors.track,
  },
  progressFill: {height: 2, backgroundColor: colors.text},
  tileTitle: {...type.bodyStrong, color: colors.textSecondary, marginTop: space.s},
  tileTitleOn: {color: colors.text},
  statusRow: {flexDirection: 'row', alignItems: 'center'},
  statusText: {...type.caption, ...numeric, flexShrink: 1},
  toneLive: {color: colors.textSecondary},
  toneDone: {color: colors.text},
  toneDead: {color: colors.textTertiary},

  // Thread: each message is a rounded row; the phone's sit on the right.
  threadGuide: {flex: 1, marginTop: 4},
  threadScroll: {flex: 1},
  threadContent: {paddingVertical: 4},
  rowWrap: {marginBottom: space.xs, alignSelf: 'flex-start', maxWidth: BUBBLE_MAX},
  rowMine: {alignSelf: 'flex-end'},
  statusRowInner: {paddingVertical: 4, paddingHorizontal: space.s},
  bubble: {paddingVertical: space.xs, paddingHorizontal: space.s},
  theirs: {backgroundColor: 'transparent'},
  mine: {backgroundColor: colors.card},
  sender: {...type.caption, ...numeric, color: colors.textTertiary},
  senderMine: {textAlign: 'right'},
  body: {...type.body, color: colors.text, marginTop: 2},
  bodyMine: {textAlign: 'right'},
  source: {...type.caption, color: colors.textSecondary, marginTop: 2},
  statusLine: {...type.caption, ...numeric},
  share: {marginTop: space.xs},
  shareType: {...type.caption, color: colors.textTertiary},
  shareTitle: {...type.bodyStrong, color: colors.text},
  shareItem: {...type.caption, color: colors.textSecondary},
  shareMore: {...type.caption, color: colors.textTertiary},
  onFocus: {color: colors.onFocus},
  onFocusDim: {color: colors.onFocus, opacity: 0.62},

  // Not paired.
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingRight: space.content - space.safeX,
  },
  emptyTitle: {...type.title, color: colors.text, marginTop: 14},
  emptyBody: {
    ...type.body,
    color: colors.textSecondary,
    textAlign: 'center',
    width: 380,
    marginTop: 6,
  },
  buttonWrap: {marginTop: 20},
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 40,
    paddingHorizontal: 18,
  },
  buttonText: {...type.bodyStrong, color: colors.text, marginLeft: space.xs},
  buttonTextFocused: {color: colors.onFocus},
});
