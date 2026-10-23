import React, {useEffect, useRef, useState} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {
  FocusManager,
  TVFocusGuideView,
} from '@amazon-devices/react-native-kepler';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from '@amazon-devices/react-native-reanimated';
import {answerStamps, formatTime} from '../analysis/composer';
import {headlineOf, jumpTarget, KIND_LABEL, nameLines} from '../analysis/cardText';
import {Answer, DossierWidget, Source, Widget} from '../analysis/schema';
import {FocusFrame} from '../components/FocusFrame';
import {colors, motion, numeric, space, type} from '../theme';
import {WidgetView} from '../widgets';
import {
  ShareContext,
  ShareRow,
  SourceLines,
  VerdictWord,
  WidgetContext,
} from '../widgets/parts';
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
// expanded. BACK goes detail → list → closed (Player owns the chain).
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
          <Text style={styles.footer} numberOfLines={1}>
            {footer}
          </Text>
        </TVFocusGuideView>
      ) : null}
    </Animated.View>
  );
};

const Body = (props: Props) => {
  const {answer, view, cards, people} = props;
  if (answer) {
    return <AnswerView answer={answer} onSeek={props.onSeek} />;
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

// ---- the list: people, collapsed cards, questions -------------------------

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

  return (
    <>
      <Text style={styles.title} numberOfLines={2}>
        {title}
      </Text>
      {showCaption ? (
        <Text
          style={styles.caption}
          numberOfLines={3}
          accessibilityLiveRegion="polite">
          {caption}
        </Text>
      ) : null}
      {onMap ? <MapAction preferred={open && mapFirst} onPress={onMap} /> : null}
      {people.length ? (
        <View style={styles.people}>
          {people.map((p) => (
            <PersonChip
              key={p.id}
              w={p}
              preferred={preferred(personKey(p.id))}
              onPress={() =>
                onView({kind: 'person', id: p.id}, personKey(p.id))
              }
            />
          ))}
        </View>
      ) : null}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        {cards.map((w) => (
          <CardRow
            key={w.id}
            w={w}
            preferred={preferred(cardKey(w.id))}
            onPress={() => onView({kind: 'card', id: w.id}, cardKey(w.id))}
          />
        ))}
      </ScrollView>
      {asks.length && onAsk ? (
        <View style={styles.asks}>
          {asks.map((a, i) => (
            <AskRow
              key={`${a.t}-${a.question}`}
              index={i}
              question={a.question}
              preferred={preferred(askKey(i))}
              onPress={() => onAsk(i)}
            />
          ))}
        </View>
      ) : null}
    </>
  );
};

// "Map": the whole conversation so far as one picture (src/map).
const MapAction = ({
  preferred,
  onPress,
}: {
  preferred: boolean;
  onPress: () => void;
}) => {
  const ref = useFocusOnMount(preferred);
  return (
    <FocusFrame
      ref={ref}
      testID="panel-map"
      accessibilityLabel="Map: see the whole conversation so far as one picture"
      variant="button"
      hasTVPreferredFocus={preferred}
      style={styles.mapAction}
      contentStyle={styles.actionInner}
      onPress={onPress}>
      {(focused) => (
        <Text style={[styles.actionText, focused && styles.onFocus]}>Map</Text>
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
  return (
    <FocusFrame
      ref={ref}
      testID={`ask-${index}`}
      accessibilityLabel={`Ask: ${question}`}
      hasTVPreferredFocus={preferred}
      style={styles.ask}
      contentStyle={styles.askInner}
      onPress={onPress}>
      {(focused) => (
        <Text
          style={[styles.askText, focused && styles.onFocus]}
          numberOfLines={2}>
          {question}
        </Text>
      )}
    </FocusFrame>
  );
};

// A collapsed card: what it is (and the verdict, as a word), then its
// headline in at most two lines. SELECT expands it.
const CardRow = ({
  w,
  preferred,
  onPress,
}: {
  w: Widget;
  preferred: boolean;
  onPress: () => void;
}) => {
  const verdict = w.type === 'claim' ? w.verdict : undefined;
  const headline = headlineOf(w);
  const ref = useFocusOnMount(preferred);
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
      onPress={onPress}>
      {(focused) => (
        <>
          <View style={styles.rowTop}>
            <Text style={[styles.rowKind, focused && styles.onFocusDim]}>
              {KIND_LABEL[w.type]}
            </Text>
            {verdict ? (
              <>
                <Text style={[styles.rowKind, focused && styles.onFocusDim]}>
                  {'  ·  '}
                </Text>
                <VerdictWord verdict={verdict} onFocus={focused} />
              </>
            ) : null}
          </View>
          <Text
            style={[styles.rowHeadline, focused && styles.onFocus]}
            numberOfLines={2}>
            {headline}
          </Text>
        </>
      )}
    </FocusFrame>
  );
};

// A person in the ribbon: a round portrait that lifts on focus (image only),
// first and last name below it, outside the scaled layer.
const PORTRAIT = 56;
const PersonChip = ({
  w,
  preferred,
  onPress,
}: {
  w: DossierWidget;
  preferred: boolean;
  onPress: () => void;
}) => {
  const [focused, setFocused] = useState(false);
  const [first, last] = nameLines(w.name);
  const ref = useFocusOnMount(preferred);
  return (
    <View style={styles.person}>
      <FocusFrame
        ref={ref}
        testID={`person-${w.id}`}
        accessibilityLabel={`${w.name}, ${w.role}. Select for details.`}
        variant="card"
        hasTVPreferredFocus={preferred}
        contentStyle={styles.portraitFrame}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onPress={onPress}>
        {() => <Portrait name={w.name} url={w.image?.url} size={PORTRAIT} />}
      </FocusFrame>
      <Text
        style={[styles.personName, focused && styles.personNameOn]}
        numberOfLines={1}>
        {first}
      </Text>
      {last ? (
        <Text
          style={[styles.personName, focused && styles.personNameOn]}
          numberOfLines={1}>
          {last}
        </Text>
      ) : null}
    </View>
  );
};

// ---- details ----------------------------------------------------------------

// A detail's actions; the preferred one takes focus when the view opens.
const Action = ({
  testID,
  label,
  accessibilityLabel,
  preferred,
  onPress,
}: {
  testID: string;
  label: string;
  accessibilityLabel?: string;
  preferred: boolean;
  onPress: () => void;
}) => {
  const ref = useFocusOnMount(preferred);
  return (
    <FocusFrame
      ref={ref}
      testID={testID}
      accessibilityLabel={accessibilityLabel ?? label}
      variant="button"
      hasTVPreferredFocus={preferred}
      style={styles.action}
      contentStyle={styles.actionInner}
      onPress={onPress}>
      {(focused) => (
        <Text style={[styles.actionText, focused && styles.onFocus]}>
          {label}
        </Text>
      )}
    </FocusFrame>
  );
};

const JumpAction = ({t, onSeek}: {t: number; onSeek: (t: number) => void}) => (
  <Action
    testID={`jump-${Math.floor(t)}`}
    label={`Jump to ${formatTime(t)}`}
    preferred
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
// the body, then its actions (Jump to, Send to phone, Show what's ahead).
const CardDetail = ({w, ...p}: Props & {w: Widget}) => {
  const ctx = ctxOf(p);
  const verdict = w.type === 'claim' ? w.verdict : undefined;
  const t = jumpTarget(w);
  // Without a curator headline, a claim's headline is the claim itself:
  // draw it whole (three lines at most) rather than cut.
  const title =
    w.type === 'claim' && !w.headline
      ? w.claim.replace(/^["“]+|["”]+$/g, '')
      : headlineOf(w);
  const shareable = w.type === 'protocol' || w.type === 'entity_list';
  const locked = w.type === 'timeline' && timelineHasLocked(w, ctx);
  return (
    <View style={styles.detail} testID={`detail-${w.id}`}>
      <View style={styles.rowTop}>
        <Text style={styles.detailKind}>{KIND_LABEL[w.type]}</Text>
        {verdict ? (
          <>
            <Text style={styles.detailKind}>{'  ·  '}</Text>
            <VerdictWord verdict={verdict} />
          </>
        ) : null}
      </View>
      <Text style={styles.detailTitle} numberOfLines={3}>
        {title}
      </Text>
      <View style={styles.detailBody}>
        <WidgetView w={w} ctx={ctx} />
      </View>
      <View style={styles.actions}>
        {t !== null && t !== undefined ? (
          <JumpAction t={t} onSeek={p.onSeek} />
        ) : null}
        {shareable ? (
          <ShareRow widgetId={w.id} title={headlineOf(w)} share={p.share} />
        ) : null}
        {locked ? (
          <Action
            testID={`reveal-${w.id}`}
            label="Show what’s ahead"
            accessibilityLabel="Show what happens later in the story"
            preferred={t === null || t === undefined}
            onPress={() => p.onLocked(headlineOf(w))}
          />
        ) : null}
      </View>
    </View>
  );
};

const PersonDetail = ({w, ...p}: Props & {w: DossierWidget}) => {
  const t = jumpTarget(w);
  return (
    <View style={styles.detail} testID={`detail-${w.id}`}>
      <DossierCard w={w} ctx={ctxOf(p)} />
      <View style={styles.actions}>
        {t !== null && t !== undefined ? (
          <JumpAction t={t} onSeek={p.onSeek} />
        ) : null}
      </View>
    </View>
  );
};

// ---- an answer ----------------------------------------------------------------

// The answer replaces the panel body, so focus cannot wander into rows
// underneath; BACK returns to the question that opened it. The answer is
// four lines at most; its sources fold under "Sources (n)".
const AnswerView = ({
  answer,
  onSeek,
}: {
  answer: AnswerState;
  onSeek: (t: number) => void;
}) => {
  const [showSources, setShowSources] = useState(false);
  const loading = answer.status === 'loading';
  const stamps = loading ? [] : answerStamps(answer.text, answer.cites, 2);
  const sources = answer.sources.slice(0, 3);
  return (
    <View style={styles.detail} testID="answer">
      <Text style={styles.detailKind} numberOfLines={1}>
        {`${answer.live ? 'Live answer' : 'Prepared answer'} · AI, not the hosts`}
      </Text>
      <Text style={styles.detailTitle} numberOfLines={2}>
        {answer.question}
      </Text>
      <View style={styles.detailBody} accessibilityLiveRegion="polite">
        {loading ? (
          <Text style={styles.answerWait}>Asking the co-viewer…</Text>
        ) : (
          <Text style={styles.answerText} numberOfLines={showSources ? 2 : 4}>
            {answer.text}
          </Text>
        )}
        {answer.note ? (
          <Text style={styles.answerNote} numberOfLines={2}>
            {answer.note}
          </Text>
        ) : null}
        {showSources ? <SourceLines sources={sources} label={false} /> : null}
      </View>
      <View style={styles.actions}>
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
      </View>
    </View>
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
  title: {...type.title, color: colors.text},
  caption: {...type.body, color: colors.textSecondary, marginTop: space.xs},
  people: {flexDirection: 'row', marginTop: space.m},
  person: {width: 72, alignItems: 'center', marginRight: space.xs},
  portraitFrame: {borderRadius: PORTRAIT / 2, backgroundColor: 'transparent'},
  personName: {
    ...type.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    width: 72,
  },
  personNameOn: {color: colors.text},
  scroll: {flex: 1, marginTop: space.m, marginHorizontal: -space.s},
  scrollContent: {paddingBottom: space.xs},
  row: {marginBottom: space.xs / 2},
  rowInner: {paddingHorizontal: space.s, paddingVertical: space.s},
  rowTop: {flexDirection: 'row', alignItems: 'center'},
  rowKind: {...type.caption, color: colors.textSecondary},
  rowHeadline: {...type.bodyStrong, color: colors.text, marginTop: 2},
  onFocus: {color: colors.onFocus},
  onFocusDim: {color: colors.onFocus, opacity: 0.62},
  asks: {marginTop: space.xs, marginHorizontal: -space.s},
  ask: {marginTop: space.xs / 2},
  askInner: {paddingHorizontal: space.s, paddingVertical: space.xs},
  askText: {...type.body, color: colors.textSecondary},
  footer: {...type.caption, color: colors.textTertiary, marginTop: space.s},
  detail: {flex: 1},
  detailKind: {...type.caption, color: colors.textSecondary},
  detailTitle: {...type.headline, color: colors.text, marginTop: 4},
  detailBody: {flex: 1, marginTop: space.m, overflow: 'hidden'},
  actions: {flexDirection: 'row', flexWrap: 'wrap', marginTop: space.xs},
  action: {marginRight: space.xs, marginTop: space.xs},
  mapAction: {alignSelf: 'flex-start', marginTop: space.s},
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
