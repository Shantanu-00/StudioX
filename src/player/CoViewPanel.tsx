import React, {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  FocusManager,
  TVFocusGuideView,
  useTVEventHandler,
} from '@amazon-devices/react-native-kepler';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from '@amazon-devices/react-native-reanimated';
import {answerStamps, formatTime} from '../analysis/composer';
import {headlineOf, jumpTarget, KIND_LABEL, nameLines} from '../analysis/cardText';
import {Answer, DossierWidget, ExploreSim, Source, Widget} from '../analysis/schema';
import {FocusFrame} from '../components/FocusFrame';
import {Icon} from '../components/Icon';
import {PhoneCard} from '../services/api';
import {answerPhoneCard, toPhoneCard} from '../services/phoneCards';
import {colors, motion, numeric, radius, space, type} from '../theme';
import {WidgetView} from '../widgets';
import {
  SEND_HINT,
  ShareContext,
  ShareRow,
  SourceLines,
  VerdictWord,
  WidgetContext,
} from '../widgets/parts';
import {TechniqueCard} from '../widgets/TechniqueCard';
import {DossierCard, Portrait, timelineHasLocked} from '../widgets/Widgets';

export const PANEL_W = 360;
const PAD = space.l; // 24 dp inner padding

// An answer open in the panel: a prepared one from the package, or a live
// one from the co-viewer agent (status `loading` until it arrives).
export interface AnswerState {
  question: string;
  t: number;
  status: 'loading' | 'ready';
  text: string;
  cites: number[];
  sources: Source[];
  live: boolean;
  note?: string;
}

// What the panel shows: the list of collapsed cards, or one card or person
// expanded. BACK goes detail → list → closed (Player owns the chain); in a
// detail or an answer, the on-screen Back and LEFT from the leftmost control
// take the same first step (`onBack`).
export type PanelView =
  | {kind: 'list'}
  | {kind: 'card'; id: string}
  | {kind: 'person'; id: string};

export const LIST: PanelView = {kind: 'list'};

// Focus keys for restoring focus to the row that opened a detail.
export const cardKey = (id: string) => `card-${id}`;
export const personKey = (id: string) => `person-${id}`;
export const askKey = (i: number) => `ask-${i}`;

interface Props {
  open: boolean;
  // The segment title (the panel's only header).
  title: string;
  // At most three cards for the moment (people are in the ribbon instead).
  cards: Widget[];
  people: DossierWidget[];
  // A real line about this moment, shown only when there are no cards.
  caption?: string | null;
  // Provenance, one tertiary line at the very bottom.
  footer: string;
  now: number;
  spoilersRevealed: boolean;
  onSeek: (t: number) => void;
  onLocked: (label: string) => void;
  view: PanelView;
  onView: (view: PanelView, focusKey: string) => void;
  // The row to focus when the list (re)mounts; null = the first one.
  focusKey: string | null;
  asks?: Answer[];
  onAsk?: (index: number) => void;
  answer?: AnswerState | null;
  share?: ShareContext;
  // Present when the episode has a Map: a "Map" action in the header.
  onMap?: () => void;
  // The Map simulation a card can open ("Try it: Plan your night"), and
  // opening it. Both present, a matching card's detail offers it first.
  simFor?: (w: Widget) => ExploreSim | null;
  onTry?: (simId: string) => void;
  // Leaves the open detail or answer for the list: the same step as BACK.
  // Without it a detail has no Back control and LEFT does nothing.
  onBack?: () => void;
  // LEFT from the list's left edge: hide the panel, the video goes back to
  // full screen and stays paused (DOWN or Menu brings the panel back).
  onHide?: () => void;
  // A phone is linked: questions can also be asked by voice there.
  paired?: boolean;
}

// The co-viewer: a solid panel on the right 360 dp; the video shrinks into
// the space on its left (Player), so nothing is ever drawn over the picture.
// The slide runs on the UI thread (Reanimated) in whole-dp steps, so text
// inside never sits between pixels; rows mount only while open so nothing
// off-screen is focusable.
export const CoViewPanel = (props: Props) => {
  const {open, footer} = props;
  const x = useSharedValue(open ? 0 : PANEL_W);
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
    }
    x.value = withTiming(open ? 0 : PANEL_W, {
      duration: motion.focusMs,
      easing: Easing.out(Easing.cubic),
    });
    if (!open) {
      const t = setTimeout(() => setMounted(false), motion.focusMs + 10);
      return () => clearTimeout(t);
    }
  }, [open, x]);

  const slide = useAnimatedStyle(() => ({
    transform: [{translateX: Math.round(x.value)}],
  }));

  return (
    <Animated.View
      style={[styles.panel, slide]}
      pointerEvents={open ? 'auto' : 'none'}>
      {mounted ? (
        <TVFocusGuideView
          trapFocusUp
          trapFocusDown
          trapFocusLeft
          trapFocusRight
          style={styles.inner}>
          <View style={styles.body}>
            <Body {...props} />
          </View>
          <Text style={styles.footer}>{footer}</Text>
        </TVFocusGuideView>
      ) : null}
    </Animated.View>
  );
};

const Body = (props: Props) => {
  const {answer, view, cards, people} = props;
  if (answer) {
    return (
      <AnswerView
        answer={answer}
        onSeek={props.onSeek}
        onBack={props.onBack}
        share={props.share}
      />
    );
  }
  if (view.kind === 'card') {
    const w = cards.find((c) => c.id === view.id);
    if (w) {
      return <CardDetail w={w} {...props} />;
    }
  }
  if (view.kind === 'person') {
    const w = people.find((c) => c.id === view.id);
    if (w) {
      return <PersonDetail w={w} {...props} />;
    }
  }
  return <ListView {...props} />;
};

// `hasTVPreferredFocus` alone did not move focus off the trapped SeekBar
// when the panel opened during playback (VVD); the preferred element also
// asks FocusManager for focus once it is mounted.
function useFocusOnMount(enabled: boolean) {
  const ref = useRef<View>(null);
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const id = setTimeout(() => {
      try {
        if (ref.current) {
          // A host-component ref: FocusManager reads its native tag.
          FocusManager.focus(
            ref.current as unknown as Parameters<typeof FocusManager.focus>[0],
          );
        }
      } catch (e) {
        console.warn('[panel] focus failed', e);
      }
    }, 0);
    return () => clearTimeout(id);
  }, [enabled]);
  return ref;
}

// ---- the list: map, people, cards, questions ------------------------------

// The list is sectioned the way TV apps section a page: a small overline
// label per group (Story map, People, the card kind, Ask) with a short
// translucent rule after it, never a full-width divider. Every section's
// content starts on the same left edge as the title.
const ListView = ({
  open,
  title,
  cards,
  people,
  caption,
  onView,
  focusKey,
  asks = [],
  onAsk,
  onMap,
  onHide,
  paired,
}: Props) => {
  // Deterministic first focus: the restored row, else the first card, else
  // the first person, else the first question.
  const keys = [
    ...cards.map((c) => cardKey(c.id)),
    ...people.map((p) => personKey(p.id)),
    ...asks.map((_, i) => askKey(i)),
  ];
  // A fresh open (no row to restore) starts on Map when there is one.
  const mapFirst = !!onMap && !(focusKey && keys.includes(focusKey));
  const first = focusKey && keys.includes(focusKey) ? focusKey : keys[0];
  const preferred = (key: string) => open && !mapFirst && key === first;
  const showCaption = cards.length === 0 && !!caption;
  // One card: its kind names the section (and the row drops its own kind
  // line); several: "This moment", each row says what it is.
  const cardsLabel = cards.length === 1 ? KIND_LABEL[cards[0].type] : 'This moment';
  const edge = useEdgeFocus(onHide);
  useTVEventHandler((evt) => {
    if (evt.eventKeyAction !== 1 && evt.eventType === 'left') {
      edge.left();
    }
  });

  // One scroll view for the whole list: header, people, cards and
  // questions wrap in full, and the view follows D-pad focus (Vega
  // ScrollView), so long text never pushes a row off the panel.
  return (
    <DetailFocus.Provider value={edge}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          {showCaption ? (
            <Text style={styles.caption} accessibilityLiveRegion="polite">
              {caption}
            </Text>
          ) : null}
        </View>
        {onMap ? (
          <View style={styles.section}>
            <SectionHead label="Story map" />
            <MapRow preferred={open && mapFirst} onPress={onMap} />
          </View>
        ) : null}
        {people.length ? (
          <View style={styles.section}>
            <SectionHead label="People" />
            <View style={styles.people}>
              {people.map((p, i) => (
                <PersonChip
                  key={p.id}
                  w={p}
                  leftmost={i === 0}
                  preferred={preferred(personKey(p.id))}
                  onPress={() =>
                    onView({kind: 'person', id: p.id}, personKey(p.id))
                  }
                />
              ))}
            </View>
          </View>
        ) : null}
        {cards.length ? (
          <View style={styles.section}>
            <SectionHead label={cardsLabel} />
            {cards.map((w) => (
              <CardRow
                key={w.id}
                w={w}
                showKind={cards.length > 1}
                preferred={preferred(cardKey(w.id))}
                onPress={() => onView({kind: 'card', id: w.id}, cardKey(w.id))}
              />
            ))}
          </View>
        ) : null}
        {asks.length && onAsk ? (
          <View style={styles.section}>
            <SectionHead label="Ask the co-viewer" />
            {asks.map((a, i) => (
              <AskRow
                key={`${a.t}-${a.question}`}
                index={i}
                question={a.question}
                preferred={preferred(askKey(i))}
                onPress={() => onAsk(i)}
              />
            ))}
            <Text style={styles.askHint}>
              {paired
                ? 'Answers are ready now. Or ask your own by voice on your phone.'
                : 'Answers are ready now. Link a phone to ask your own by voice.'}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </DetailFocus.Provider>
  );
};

// A section's overline: the label, then a short translucent rule.
const SectionHead = ({label}: {label: string}) => (
  <View style={styles.sectionHead} accessibilityRole="header">
    <Text style={styles.sectionLabel}>{label.toUpperCase()}</Text>
    <View style={styles.sectionRule} />
  </View>
);

// The Map as a row that says what it is: a play mark, what it does and what
// you will see, so a first-time viewer knows why to open it.
const MapRow = ({
  preferred,
  onPress,
}: {
  preferred: boolean;
  onPress: () => void;
}) => {
  const ref = useFocusOnMount(preferred);
  const slot = useDetailSlot({edge: true});
  return (
    <FocusFrame
      ref={ref}
      testID="panel-map"
      accessibilityLabel="Play the story map: the whole story so far as one picture, piece by piece"
      hasTVPreferredFocus={preferred}
      style={styles.row}
      contentStyle={[styles.rowInner, styles.mapInner]}
      onFocus={slot.onFocus}
      onBlur={slot.onBlur}
      onPress={onPress}>
      {(focused) => (
        <>
          <View style={[styles.playMark, focused && styles.playMarkOn]}>
            <Icon
              name="play"
              size={14}
              color={focused ? colors.text : colors.onFocus}
            />
          </View>
          <View style={styles.mapText}>
            <Text style={[styles.rowHeadline, styles.noGap, focused && styles.onFocus]}>
              Play the story map
            </Text>
            <Text style={[styles.rowKind, focused && styles.onFocusDim]}>
              The whole story so far as one picture
            </Text>
          </View>
        </>
      )}
    </FocusFrame>
  );
};

const AskRow = ({
  index,
  question,
  preferred,
  onPress,
}: {
  index: number;
  question: string;
  preferred: boolean;
  onPress: () => void;
}) => {
  const ref = useFocusOnMount(preferred);
  const slot = useDetailSlot({edge: true});
  return (
    <FocusFrame
      ref={ref}
      testID={`ask-${index}`}
      accessibilityLabel={`Ask: ${question}`}
      hasTVPreferredFocus={preferred}
      style={styles.ask}
      contentStyle={styles.askInner}
      onFocus={slot.onFocus}
      onBlur={slot.onBlur}
      onPress={onPress}>
      {(focused) => (
        <Text style={[styles.askText, focused && styles.onFocus]}>
          {question}
        </Text>
      )}
    </FocusFrame>
  );
};

// A collapsed card: what it is (and the verdict, as a word), then its
// headline (70 characters at most, wrapped in full). SELECT expands it.
const CardRow = ({
  w,
  showKind,
  preferred,
  onPress,
}: {
  w: Widget;
  // False when the section label already names the kind.
  showKind: boolean;
  preferred: boolean;
  onPress: () => void;
}) => {
  const verdict = w.type === 'claim' ? w.verdict : undefined;
  const headline = headlineOf(w);
  const ref = useFocusOnMount(preferred);
  const slot = useDetailSlot({edge: true});
  return (
    <FocusFrame
      ref={ref}
      testID={`card-${w.id}`}
      accessibilityLabel={`${KIND_LABEL[w.type]}${
        verdict ? `, ${verdict.toLowerCase()}` : ''
      }. ${headline}. Select for details.`}
      hasTVPreferredFocus={preferred}
      style={styles.row}
      contentStyle={styles.rowInner}
      onFocus={slot.onFocus}
      onBlur={slot.onBlur}
      onPress={onPress}>
      {(focused) => (
        <>
          {showKind || verdict ? (
            <View style={styles.rowTop}>
              {showKind ? (
                <Text style={[styles.rowKind, focused && styles.onFocusDim]}>
                  {KIND_LABEL[w.type]}
                </Text>
              ) : null}
              {showKind && verdict ? (
                <Text style={[styles.rowKind, focused && styles.onFocusDim]}>
                  {'  ·  '}
                </Text>
              ) : null}
              {verdict ? <VerdictWord verdict={verdict} onFocus={focused} /> : null}
            </View>
          ) : null}
          <Text
            style={[
              styles.rowHeadline,
              !(showKind || verdict) && styles.noGap,
              focused && styles.onFocus,
            ]}>
            {headline}
          </Text>
        </>
      )}
    </FocusFrame>
  );
};

// A person in the ribbon: a round portrait that lifts on focus and gets a
// 2 dp white ring (a shape: a fill alone would not read as focus), first and
// last name below it, outside the scaled layer.
const PORTRAIT = 56;
const RING = 2;
const RING_GAP = 2;
const CHIP = PORTRAIT + 2 * (RING + RING_GAP);
const PersonChip = ({
  w,
  leftmost,
  preferred,
  onPress,
}: {
  w: DossierWidget;
  leftmost: boolean;
  preferred: boolean;
  onPress: () => void;
}) => {
  const [focused, setFocused] = useState(false);
  const [first, last] = nameLines(w.name);
  const ref = useFocusOnMount(preferred);
  // Only the first chip of the ribbon is on the panel's left edge.
  const slot = useDetailSlot({edge: leftmost});
  return (
    <View style={styles.person}>
      <FocusFrame
        ref={ref}
        testID={`person-${w.id}`}
        accessibilityLabel={`${w.name}, ${w.role}. Select for details.`}
        variant="card"
        hasTVPreferredFocus={preferred}
        contentStyle={styles.portraitFrame}
        onFocus={() => {
          setFocused(true);
          slot.onFocus();
        }}
        onBlur={() => {
          setFocused(false);
          slot.onBlur();
        }}
        onPress={onPress}>
        {(on) => (
          <>
            <Portrait name={w.name} url={w.image?.url} size={PORTRAIT} />
            <View
              testID={on ? `person-ring-${w.id}` : undefined}
              pointerEvents="none"
              style={[styles.ring, on && styles.ringOn]}
            />
          </>
        )}
      </FocusFrame>
      <Text style={[styles.personName, focused && styles.personNameOn]}>
        {first}
      </Text>
      {last ? (
        <Text style={[styles.personName, focused && styles.personNameOn]}>
          {last}
        </Text>
      ) : null}
    </View>
  );
};

// ---- details ----------------------------------------------------------------

// A detail is a reader (the text, scrolled with the D-pad when it is taller
// than the panel) above a fixed row of actions, Back first. The actions can
// never be pushed off-screen by long text. LEFT from the leftmost control
// (Back, the first action of a wrapped row, or the reader) leaves the detail,
// like BACK.

// Which detail control has focus. `since` guards LEFT: a key event can reach
// JS just after the focus move it caused, so LEFT closes only from a control
// that already had focus before the key went down.
interface Spot {
  id: object;
  edge: boolean;
  reader: boolean;
  since: number;
}
interface DetailApi {
  enter: (id: object, edge: boolean, reader: boolean) => void;
  leave: (id: object) => void;
}
const DetailFocus = createContext<DetailApi | null>(null);
export const LEFT_SETTLE_MS = 80;

// Wires one control into the detail's focus tracking. Actions sit in a
// wrapping row: a slot laid out at x = 0 is the leftmost of its line (until
// it is measured it is not). Back is always leftmost.
function useDetailSlot({edge = false} = {}) {
  const api = useContext(DetailFocus);
  const id = useRef({}).current;
  const x = useRef(Number.NaN);
  return {
    onLayout: (e: LayoutChangeEvent) => {
      x.current = e.nativeEvent.layout.x;
    },
    onFocus: () => api?.enter(id, edge || Math.abs(x.current) < 1, false),
    onBlur: () => api?.leave(id),
  };
}

// Tracks which control has focus; `left()` takes the LEFT step (`onLeft`)
// when it comes from a control on the left edge that had already settled
// there (the list hides the panel, a detail goes back).
function useEdgeFocus(onLeft?: () => void) {
  const spot = useRef<Spot | null>(null);
  const leftRef = useRef(onLeft);
  leftRef.current = onLeft;
  return useMemo(
    () => ({
      spot,
      enter: (id: object, edge: boolean, reader: boolean) => {
        spot.current = {id, edge, reader, since: Date.now()};
      },
      leave: (id: object) => {
        if (spot.current?.id === id) {
          spot.current = null;
        }
      },
      left: () => {
        const s = spot.current;
        if (s?.edge && leftRef.current && Date.now() - s.since >= LEFT_SETTLE_MS) {
          leftRef.current();
        }
      },
    }),
    [],
  );
}

const DetailFrame = ({
  testID,
  onBack,
  backPreferred,
  actions,
  note,
  children,
}: {
  testID: string;
  onBack?: () => void;
  backPreferred: boolean;
  actions?: ReactNode;
  // One quiet line under the actions (never focusable).
  note?: string | null;
  children: ReactNode;
}) => {
  const api = useEdgeFocus(onBack);
  const spot = api.spot;

  // The reader: scroll offsets in refs (the key handler reads them), plus
  // state so the hint and the DOWN block follow.
  const scroll = useRef<ScrollView>(null);
  const viewH = useRef(0);
  const contentH = useRef(0);
  const y = useRef(0);
  const [, setTick] = useState(0);
  const maxY = () => Math.max(0, Math.ceil(contentH.current - viewH.current));
  const scrollTo = (next: number, animated = true) => {
    const to = Math.max(0, Math.min(maxY(), Math.round(next)));
    if (to !== y.current) {
      y.current = to;
      scroll.current?.scrollTo({y: to, animated});
    }
    setTick((n) => n + 1);
  };
  const measured = () => scrollTo(y.current, false); // re-clamp after a resize
  const overflow = maxY() > 1;
  const atEnd = y.current >= maxY() - 1;

  useTVEventHandler((evt) => {
    if (evt.eventKeyAction === 1) {
      return; // key up
    }
    const s = spot.current;
    if (!s) {
      return;
    }
    if (evt.eventType === 'left') {
      api.left();
      return;
    }
    if (s.reader && (evt.eventType === 'down' || evt.eventType === 'up')) {
      const step = Math.max(48, Math.round(viewH.current * 0.7));
      scrollTo(y.current + (evt.eventType === 'down' ? step : -step));
    }
  });

  // The reader is part of the frame (outside its own provider).
  const readerId = useRef({}).current;
  const [self, setSelf] = useState<View | null>(null);
  const [reading, setReading] = useState(false);
  // UP is blocked on the reader (nothing above it); DOWN is blocked until
  // the text has been read to the end, then moves on to the actions.
  // Vega's Pressable implements nextFocus*, its types omit them.
  const block: object = self
    ? {nextFocusUp: self, nextFocusDown: atEnd ? undefined : self}
    : {};

  return (
    <DetailFocus.Provider value={api}>
      <View style={styles.detail} testID={testID}>
        <Pressable
          ref={setSelf}
          testID="detail-reader"
          accessibilityLabel="Details. Press up or down to read."
          focusable={overflow}
          {...block}
          style={[styles.reader, reading && styles.readerOn]}
          onFocus={() => {
            setReading(true);
            api.enter(readerId, true, true);
          }}
          onBlur={() => {
            setReading(false);
            api.leave(readerId);
          }}>
          <ScrollView
            ref={scroll}
            testID="detail-reader-scroll"
            style={styles.readerScroll}
            showsVerticalScrollIndicator={false}
            onLayout={(e) => {
              viewH.current = e.nativeEvent.layout.height;
              measured();
            }}
            onContentSizeChange={(_, h) => {
              contentH.current = h;
              measured();
            }}>
            {children}
          </ScrollView>
        </Pressable>
        {overflow ? (
          <Text style={styles.readerHint} testID="detail-reader-hint">
            {reading
              ? atEnd
                ? 'Press ▼ for the actions'
                : 'Press ▲ ▼ to scroll'
              : 'Press ▲ to read more'}
          </Text>
        ) : null}
        <View style={styles.actions}>
          {onBack ? (
            <Action
              testID="detail-back"
              label="Back"
              accessibilityLabel="Back to the list"
              preferred={backPreferred}
              edge
              onPress={onBack}
            />
          ) : null}
          {actions}
        </View>
        {note ? (
          <Text style={styles.detailNote} testID="detail-note">
            {note}
          </Text>
        ) : null}
      </View>
    </DetailFocus.Provider>
  );
};

// A detail's actions; the preferred one takes focus when the view opens.
const Action = ({
  testID,
  label,
  accessibilityLabel,
  preferred,
  edge = false,
  onPress,
}: {
  testID: string;
  label: string;
  accessibilityLabel?: string;
  preferred: boolean;
  // Always the leftmost control (Back).
  edge?: boolean;
  onPress: () => void;
}) => {
  const ref = useFocusOnMount(preferred);
  const slot = useDetailSlot({edge});
  return (
    <View testID={`${testID}-slot`} onLayout={slot.onLayout}>
      <FocusFrame
        ref={ref}
        testID={testID}
        accessibilityLabel={accessibilityLabel ?? label}
        variant="button"
        hasTVPreferredFocus={preferred}
        style={styles.action}
        contentStyle={styles.actionInner}
        onFocus={slot.onFocus}
        onBlur={slot.onBlur}
        onPress={onPress}>
        {(focused) => (
          <Text style={[styles.actionText, focused && styles.onFocus]}>
            {label}
          </Text>
        )}
      </FocusFrame>
    </View>
  );
};

// "Send to phone" as a detail action (tracked like the others). Never the
// preferred action: it sits after Back and Jump to.
const ShareAction = (props: {
  shareKey: string;
  testID: string;
  title: string;
  card: () => PhoneCard;
  share?: ShareContext;
}) => {
  const slot = useDetailSlot();
  return props.share ? (
    <View testID={`${props.testID}-slot`} onLayout={slot.onLayout}>
      <ShareRow {...props} onFocus={slot.onFocus} onBlur={slot.onBlur} />
    </View>
  ) : null;
};

const JumpAction = ({
  t,
  preferred = true,
  onSeek,
}: {
  t: number;
  preferred?: boolean;
  onSeek: (t: number) => void;
}) => (
  <Action
    testID={`jump-${Math.floor(t)}`}
    label={`Jump to ${formatTime(t)}`}
    preferred={preferred}
    onPress={() => onSeek(t)}
  />
);

const ctxOf = (p: Props): WidgetContext => ({
  now: p.now,
  onSeek: p.onSeek,
  onLocked: p.onLocked,
  spoilersRevealed: p.spoilersRevealed,
  firstFocus: false,
  share: p.share,
});

// One card expanded in place of the list: kind and verdict, the headline,
// the body, then its actions (Back, Jump to, Send to phone, Show what's
// ahead, Play). A technique's demonstration runs only on Play.
const CardDetail = ({w, ...p}: Props & {w: Widget}) => {
  const ctx = ctxOf(p);
  const [plays, setPlays] = useState(0);
  const verdict = w.type === 'claim' ? w.verdict : undefined;
  const t = jumpTarget(w);
  // Without a curator headline, a claim's headline is the claim itself:
  // draw it whole rather than cut.
  const title =
    w.type === 'claim' && !w.headline
      ? w.claim.replace(/^["“]+|["”]+$/g, '')
      : headlineOf(w);
  const locked = w.type === 'timeline' && timelineHasLocked(w, ctx);
  const playable = w.type === 'technique';
  // A card a Map simulation belongs to: trying it is the first action.
  const sim = p.onTry && p.simFor ? p.simFor(w) : null;
  const onTry = p.onTry;
  return (
    <DetailFrame
      testID={`detail-${w.id}`}
      onBack={p.onBack}
      backPreferred={t === null && !locked && !playable && !sim}
      note={p.share ? null : SEND_HINT}
      actions={
        <>
          {sim && onTry ? (
            <Action
              testID={`try-${w.id}`}
              label={`Try it: ${sim.title}`}
              accessibilityLabel={`Try it: ${sim.title}. Back returns here.`}
              preferred
              onPress={() => onTry(sim.id)}
            />
          ) : null}
          {t !== null ? <JumpAction t={t} preferred={!sim} onSeek={p.onSeek} /> : null}
          <ShareAction
            shareKey={w.id}
            testID={`share-${w.id}`}
            title={headlineOf(w)}
            card={() => toPhoneCard(w, p)}
            share={p.share}
          />
          {locked ? (
            <Action
              testID={`reveal-${w.id}`}
              label="Show what’s ahead"
              accessibilityLabel="Show what happens later in the story"
              preferred={t === null && !sim}
              onPress={() => p.onLocked(headlineOf(w))}
            />
          ) : null}
          {playable ? (
            <Action
              testID={`play-${w.id}`}
              label={plays ? 'Play again' : 'Play'}
              accessibilityLabel={`Play the demonstration: ${w.title}`}
              preferred={t === null && !sim}
              onPress={() => setPlays((n) => n + 1)}
            />
          ) : null}
        </>
      }>
      <View style={styles.rowTop}>
        <Text style={styles.detailKind}>{KIND_LABEL[w.type]}</Text>
        {verdict ? (
          <>
            <Text style={styles.detailKind}>{'  ·  '}</Text>
            <VerdictWord verdict={verdict} />
          </>
        ) : null}
      </View>
      <Text style={styles.detailTitle}>{title}</Text>
      <View style={styles.detailBody}>
        {w.type === 'technique' ? (
          <TechniqueCard w={w} playToken={plays} />
        ) : (
          <WidgetView w={w} ctx={ctx} />
        )}
      </View>
    </DetailFrame>
  );
};

// A person: the photo large beside the name, the facts, Jump to only when a
// fact or the card has a real timestamp, and Send to phone.
const PersonDetail = ({w, ...p}: Props & {w: DossierWidget}) => {
  const t = jumpTarget(w);
  return (
    <DetailFrame
      testID={`detail-${w.id}`}
      onBack={p.onBack}
      backPreferred={t === null}
      note={p.share ? null : SEND_HINT}
      actions={
        <>
          {t !== null ? <JumpAction t={t} onSeek={p.onSeek} /> : null}
          <ShareAction
            shareKey={w.id}
            testID={`share-${w.id}`}
            title={w.name}
            card={() => toPhoneCard(w, p)}
            share={p.share}
          />
        </>
      }>
      <DossierCard w={w} ctx={ctxOf(p)} />
    </DetailFrame>
  );
};

// ---- an answer ----------------------------------------------------------------

// The answer replaces the panel body, so focus cannot wander into rows
// underneath; Back, LEFT or BACK returns to the question that opened it. The
// answer wraps in full (the reader scrolls it); its sources fold under
// "Sources (n)".
const AnswerView = ({
  answer,
  onSeek,
  onBack,
  share,
}: {
  answer: AnswerState;
  onSeek: (t: number) => void;
  onBack?: () => void;
  share?: ShareContext;
}) => {
  const [showSources, setShowSources] = useState(false);
  const loading = answer.status === 'loading';
  const stamps = loading ? [] : answerStamps(answer.text, answer.cites, 2);
  const sources = answer.sources.slice(0, 3);
  return (
    <DetailFrame
      testID="answer"
      onBack={onBack}
      backPreferred={stamps.length === 0 && sources.length === 0}
      note={loading || share ? null : SEND_HINT}
      actions={
        <>
          {stamps.map((t, i) => (
            <Action
              key={t}
              testID={`answer-cite-${t}`}
              label={`Jump to ${formatTime(t)}`}
              preferred={i === 0}
              onPress={() => onSeek(t)}
            />
          ))}
          {sources.length ? (
            <Action
              testID="answer-sources"
              label={`Sources (${sources.length})`}
              accessibilityLabel={`${showSources ? 'Hide' : 'Show'} ${
                sources.length
              } sources`}
              preferred={stamps.length === 0}
              onPress={() => setShowSources((s) => !s)}
            />
          ) : null}
          {loading ? null : (
            <ShareAction
              shareKey={`answer-${answer.live ? 'live' : 'prepared'}-${answer.t}-${
                answer.question
              }`}
              testID="share-answer"
              title={answer.question}
              card={() => answerPhoneCard(answer)}
              share={share}
            />
          )}
        </>
      }>
      <Text style={styles.detailKind}>
        {`${answer.live ? 'Live answer' : 'Prepared answer'} · AI, not the hosts`}
      </Text>
      <Text style={styles.detailTitle}>{answer.question}</Text>
      <View style={styles.detailBody} accessibilityLiveRegion="polite">
        {loading ? (
          <Text style={styles.answerWait}>Asking the co-viewer…</Text>
        ) : (
          <Text style={styles.answerText}>{answer.text}</Text>
        )}
        {answer.note ? (
          <Text style={styles.answerNote}>{answer.note}</Text>
        ) : null}
        {showSources ? <SourceLines sources={sources} label={false} /> : null}
      </View>
    </DetailFrame>
  );
};

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: PANEL_W,
    backgroundColor: colors.panel,
  },
  inner: {
    flex: 1,
    paddingHorizontal: PAD,
    paddingTop: PAD,
    paddingBottom: space.m,
  },
  body: {flex: 1},
  header: {paddingHorizontal: space.s},
  section: {marginTop: space.l},
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.s,
    marginBottom: space.xs,
  },
  sectionLabel: {...type.overline, color: colors.textTertiary},
  // Short and translucent: it groups, it does not cut the panel in two.
  sectionRule: {
    flex: 1,
    maxWidth: 120,
    height: 1,
    marginLeft: space.s,
    backgroundColor: 'rgba(235,235,245,0.14)',
  },
  mapInner: {flexDirection: 'row', alignItems: 'center'},
  playMark: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: space.s,
    paddingLeft: 2, // optical centre of the triangle
  },
  playMarkOn: {backgroundColor: colors.onFocus},
  mapText: {flex: 1},
  noGap: {marginTop: 0},
  askHint: {
    ...type.caption,
    color: colors.textTertiary,
    paddingHorizontal: space.s,
    marginTop: space.xs,
  },
  title: {...type.title, color: colors.text},
  caption: {...type.body, color: colors.textSecondary, marginTop: space.xs},
  // The ring's outer edge lines up with the text column; names centre under
  // their portrait.
  people: {flexDirection: 'row', paddingHorizontal: space.s},
  person: {width: CHIP, alignItems: 'center', marginRight: space.m},
  portraitFrame: {
    width: CHIP,
    height: CHIP,
    borderRadius: CHIP / 2,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: CHIP / 2,
    borderWidth: RING,
    borderColor: 'transparent',
  },
  ringOn: {borderColor: colors.text},
  personName: {
    ...type.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    width: CHIP + space.m,
  },
  personNameOn: {color: colors.text},
  // Pulled out by the rows' padding so focus fills reach past the text.
  scroll: {flex: 1, marginHorizontal: -space.s},
  scrollContent: {paddingBottom: space.xs},
  row: {marginBottom: space.xs / 2},
  rowInner: {paddingHorizontal: space.s, paddingVertical: space.s},
  rowTop: {flexDirection: 'row', alignItems: 'center'},
  rowKind: {...type.caption, color: colors.textSecondary},
  rowHeadline: {...type.bodyStrong, color: colors.text, marginTop: 2},
  onFocus: {color: colors.onFocus},
  onFocusDim: {color: colors.onFocus, opacity: 0.62},
  ask: {marginBottom: space.xs / 2},
  askInner: {paddingHorizontal: space.s, paddingVertical: space.xs},
  askText: {...type.body, color: colors.textSecondary},
  footer: {...type.caption, color: colors.textTertiary, marginTop: space.s},
  detail: {flex: 1},
  // The reader keeps the text at the panel's 312 dp column: pulled out by
  // its padding plus the 2 dp ring, which shows only while it has focus.
  reader: {
    flex: 1,
    marginHorizontal: -space.s,
    paddingHorizontal: space.s - RING,
    borderWidth: RING,
    borderColor: 'transparent',
    borderRadius: radius.row,
  },
  readerOn: {borderColor: colors.text},
  readerScroll: {flex: 1},
  readerHint: {...type.caption, color: colors.textTertiary, marginTop: 4},
  detailKind: {...type.caption, color: colors.textSecondary},
  detailTitle: {...type.headline, color: colors.text, marginTop: 4},
  detailBody: {marginTop: space.m, paddingBottom: space.xs},
  detailNote: {...type.caption, color: colors.textTertiary, marginTop: space.xs},
  actions: {flexDirection: 'row', flexWrap: 'wrap', marginTop: space.xs},
  action: {marginRight: space.xs, marginTop: space.xs},
  actionInner: {
    height: 40,
    paddingHorizontal: space.m,
    justifyContent: 'center',
  },
  actionText: {...type.bodyStrong, ...numeric, color: colors.text},
  answerWait: {...type.body, color: colors.textSecondary},
  answerText: {...type.body, color: colors.text},
  answerNote: {...type.caption, color: colors.textSecondary, marginTop: space.xs},
});
