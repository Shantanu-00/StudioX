import React, {useEffect, useState} from 'react';
import {Image, ScrollView, StyleSheet, Text, View} from 'react-native';
import {TVFocusGuideView} from '@amazon-devices/react-native-kepler';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from '@amazon-devices/react-native-reanimated';
import Svg, {Path} from '@amazon-devices/react-native-svg';
import {formatTime} from '../analysis/composer';
import {Answer, ExploreNode, ExploreSim, Source} from '../analysis/schema';
import {FocusFrame} from '../components/FocusFrame';
import {colors, numeric, space, type} from '../theme';
import {SEND_HINT, SourceLines, VerdictWord} from '../widgets/parts';
import {useFocusOnMount} from './focus';
import {imageSource} from './images';
import {creditText, isNumber, showsVerdict, valueText} from './scene/measure';
import {MapAnswer, SendStatus, sendLabel} from './useMapActions';

export const SHEET_W = 360;
const SLIDE_MS = 250;
const INNER_W = SHEET_W - 2 * space.l;

interface Props {
  node: ExploreNode;
  locked: boolean;
  // The sim this node opens, if any.
  sim: ExploreSim | null;
  hasVideo: boolean;
  questions: Answer[];
  // Live mode with a session: a free question about the node is offered too.
  canAskLive: boolean;
  paired: boolean;
  sendStatus: SendStatus;
  answer: MapAnswer | null;
  // Which action row to focus when the sheet (re)opens.
  focusAction: string | null;
  // The on-screen Back (and LEFT, via MapScreen): one step of the BACK chain.
  onBack: () => void;
  onPlay: () => void;
  onTry: () => void;
  onAsk: (question: string, prepared: Answer | null, key: string) => void;
  onSend: () => void;
  onKeepWatching: () => void;
  onCloseAnswer: () => void;
}

export const LIVE_QUESTION = 'What should I know about this?';

// A node opened: a solid sheet on the right 360 dp, the map still visible
// (dimmed) on its left. Focus is trapped inside; its first item is an
// on-screen Back, and LEFT or BACK close the answer, then the sheet
// (MapScreen owns the chain and restores focus to the node). Everything
// wraps in full; the sheet scrolls with D-pad focus when it is long.
export const NodeSheet = (props: Props) => {
  const x = useSharedValue(SHEET_W);
  useEffect(() => {
    x.value = withTiming(0, {
      duration: SLIDE_MS,
      easing: Easing.out(Easing.cubic),
    });
    return () => cancelAnimation(x);
  }, [x]);
  const slide = useAnimatedStyle(() => ({
    transform: [{translateX: Math.round(x.value)}],
  }));
  return (
    <Animated.View style={[styles.sheet, slide]} testID="map-sheet">
      <TVFocusGuideView
        trapFocusUp
        trapFocusDown
        trapFocusLeft
        trapFocusRight
        style={styles.inner}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}>
          {props.answer ? (
            <AnswerBody answer={props.answer} onBack={props.onBack} onCloseAnswer={props.onCloseAnswer} />
          ) : props.locked ? (
            <LockedBody
              onBack={props.onBack}
              onKeepWatching={props.onKeepWatching}
              hasVideo={props.hasVideo}
            />
          ) : (
            <NodeBody {...props} />
          )}
        </ScrollView>
      </TVFocusGuideView>
    </Animated.View>
  );
};

// The sheet's first item: ◀ Back.
const BackRow = ({preferred, onPress}: {preferred: boolean; onPress: () => void}) => {
  const ref = useFocusOnMount<View>(preferred);
  return (
    <FocusFrame
      ref={ref}
      testID="sheet-back"
      accessibilityLabel="Back to the map"
      variant="row"
      hasTVPreferredFocus={preferred}
      style={styles.backRow}
      contentStyle={styles.backInner}
      onPress={onPress}>
      {(focused) => (
        <>
          <Svg width={12} height={12} viewBox="0 0 12 12">
            <Path d="M9 1 L2.5 6 L9 11 Z" fill={focused ? colors.onFocus : colors.text} />
          </Svg>
          <Text style={[styles.backText, focused && styles.onFocus]}>Back</Text>
        </>
      )}
    </FocusFrame>
  );
};

const NodeBody = ({
  node,
  sim,
  hasVideo,
  questions,
  canAskLive,
  paired,
  sendStatus,
  focusAction,
  onBack,
  onPlay,
  onTry,
  onAsk,
  onSend,
}: Props) => {
  const number = isNumber(node) && node.value;
  const when = [
    node.when,
    hasVideo && node.t !== null ? `Said at ${formatTime(node.t)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const rows: Array<{key: string; label: string; a11y: string; onPress: () => void}> = [];
  // A moment to play only when the node has one.
  if (hasVideo && node.t !== null) {
    rows.push({
      key: 'play',
      label: 'Play this moment',
      a11y: `Play this moment, from ${formatTime(node.t)}`,
      onPress: onPlay,
    });
  }
  if (sim) {
    rows.push({key: 'try', label: `Try it: ${sim.title}`, a11y: `Try it: ${sim.title}`, onPress: onTry});
  }
  const asks = questions.map((q, i) => ({
    key: `ask-${i}`,
    label: q.question,
    a11y: `Ask: ${q.question}`,
    onPress: () => onAsk(q.question, q, `ask-${i}`),
  }));
  if (canAskLive && asks.length === 0) {
    asks.push({
      key: 'ask-live',
      label: LIVE_QUESTION,
      a11y: `Ask: ${LIVE_QUESTION}`,
      onPress: () => onAsk(LIVE_QUESTION, null, 'ask-live'),
    });
  }
  const first = focusAction ?? rows[0]?.key ?? asks[0]?.key ?? (paired ? 'send' : 'back');
  return (
    <View style={styles.body}>
      <BackRow preferred={first === 'back'} onPress={onBack} />
      {node.image ? (
        <View style={styles.imageBox}>
          <Image
            source={imageSource(node.image.url)}
            style={styles.image}
            resizeMode="cover"
            accessibilityIgnoresInvertColors
            testID="sheet-image"
          />
          <Text style={styles.credit}>{creditText(node.image.credit)}</Text>
        </View>
      ) : null}
      {when || showsVerdict(node) ? (
        <View style={styles.metaRow}>
          {when ? <Text style={styles.meta}>{when}</Text> : null}
          {showsVerdict(node) ? (
            <>
              {when ? <Text style={styles.meta}>{'  ·  '}</Text> : null}
              <VerdictWord verdict={node.verdict ?? undefined} />
            </>
          ) : null}
        </View>
      ) : null}
      {number && node.value ? (
        <Text style={styles.value} testID="sheet-value">
          {valueText(node.value)}
        </Text>
      ) : null}
      <Text style={number ? styles.labelUnderValue : styles.headline}>{node.label}</Text>
      {node.detail ? <Text style={styles.detail}>{node.detail}</Text> : null}
      <View style={styles.actions}>
        {rows.map((r) => (
          <ActionRow
            key={r.key}
            testID={`sheet-${r.key}`}
            label={r.label}
            accessibilityLabel={r.a11y}
            preferred={first === r.key}
            onPress={r.onPress}
          />
        ))}
        {asks.length ? <Text style={styles.section}>Ask about this</Text> : null}
        {asks.map((r) => (
          <ActionRow
            key={r.key}
            testID={`sheet-${r.key}`}
            label={r.label}
            accessibilityLabel={r.a11y}
            preferred={first === r.key}
            quiet
            onPress={r.onPress}
          />
        ))}
        {paired && asks.length ? (
          <Text style={styles.hint}>Or ask by voice on your phone</Text>
        ) : null}
        {paired ? (
          <ActionRow
            testID="sheet-send"
            label={sendLabel(sendStatus)}
            accessibilityLabel={`${sendLabel(sendStatus)}: ${node.label}`}
            preferred={first === 'send'}
            onPress={sendStatus === 'sending' || sendStatus === 'sent' ? undefined : onSend}
          />
        ) : (
          <Text style={styles.sendHint} testID="sheet-send-hint">
            {SEND_HINT}
          </Text>
        )}
      </View>
    </View>
  );
};

const LockedBody = ({
  onBack,
  onKeepWatching,
  hasVideo,
}: {
  onBack: () => void;
  onKeepWatching: () => void;
  hasVideo: boolean;
}) => (
  <View style={styles.body}>
    <BackRow preferred={!hasVideo} onPress={onBack} />
    <Text style={styles.meta}>Later in the episode</Text>
    <Text style={styles.headline}>Keep watching</Text>
    <Text style={styles.detail}>
      This piece unlocks when the episode gets there. StudioX has seen it, and
      won’t spoil it.
    </Text>
    <View style={styles.actions}>
      {hasVideo ? (
        <ActionRow
          testID="sheet-keep-watching"
          label="Keep watching"
          accessibilityLabel="Keep watching from where you paused"
          preferred
          onPress={onKeepWatching}
        />
      ) : null}
    </View>
  </View>
);

const AnswerBody = ({
  answer,
  onBack,
  onCloseAnswer,
}: {
  answer: MapAnswer;
  onBack: () => void;
  onCloseAnswer: () => void;
}) => {
  const [showSources, setShowSources] = useState(false);
  const loading = answer.status === 'loading';
  const sources: Source[] = answer.sources.slice(0, 3);
  return (
    <View style={styles.body} testID="map-answer">
      <BackRow preferred={false} onPress={onBack} />
      <Text style={styles.meta}>
        {`${answer.live ? 'Live answer' : 'Prepared answer'} · AI, not the hosts`}
      </Text>
      <Text style={styles.headline}>{answer.question}</Text>
      <View accessibilityLiveRegion="polite" style={styles.answerBox}>
        {loading ? (
          <Text style={styles.detailQuiet}>Asking the co-viewer…</Text>
        ) : (
          <Text style={styles.detail}>{answer.text}</Text>
        )}
        {answer.note ? <Text style={styles.hint}>{answer.note}</Text> : null}
        {showSources ? <SourceLines sources={sources} label={false} /> : null}
      </View>
      <View style={styles.actions}>
        {sources.length && !loading ? (
          <ActionRow
            testID="answer-sources"
            label={`Sources (${sources.length})`}
            accessibilityLabel={`${showSources ? 'Hide' : 'Show'} ${sources.length} sources`}
            preferred
            onPress={() => setShowSources((s) => !s)}
          />
        ) : null}
        <ActionRow
          testID="answer-back"
          label="Back to this piece"
          accessibilityLabel="Back to this piece of the map"
          preferred={!sources.length || loading}
          onPress={onCloseAnswer}
        />
      </View>
    </View>
  );
};

const ActionRow = ({
  testID,
  label,
  accessibilityLabel,
  preferred,
  onPress,
  quiet = false,
}: {
  testID: string;
  label: string;
  accessibilityLabel: string;
  preferred: boolean;
  onPress?: () => void;
  quiet?: boolean;
}) => {
  const ref = useFocusOnMount<View>(preferred);
  return (
    <FocusFrame
      ref={ref}
      testID={testID}
      accessibilityLabel={accessibilityLabel}
      variant={quiet ? 'row' : 'button'}
      hasTVPreferredFocus={preferred}
      style={styles.row}
      contentStyle={styles.rowInner}
      onPress={onPress}>
      {(focused) => (
        <Text
          style={[
            quiet ? styles.rowQuiet : styles.rowText,
            focused && styles.onFocus,
          ]}>
          {label}
        </Text>
      )}
    </FocusFrame>
  );
};

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: SHEET_W,
    backgroundColor: colors.panel,
  },
  inner: {flex: 1},
  scroll: {flex: 1},
  scrollContent: {padding: space.l, paddingTop: space.m},
  body: {flex: 1},
  backRow: {alignSelf: 'flex-start', marginLeft: -space.s, marginBottom: space.xs},
  backInner: {
    minHeight: 36,
    paddingHorizontal: space.s,
    flexDirection: 'row',
    alignItems: 'center',
  },
  backText: {...type.bodyStrong, color: colors.text, marginLeft: space.xs},
  imageBox: {marginBottom: space.s},
  image: {width: INNER_W, height: 156, borderRadius: 8, backgroundColor: colors.card},
  credit: {...type.caption, color: colors.textSecondary, marginTop: 4},
  metaRow: {flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center'},
  meta: {...type.caption, ...numeric, color: colors.textSecondary},
  value: {...type.title, ...numeric, color: colors.text, marginTop: 4},
  headline: {...type.headline, color: colors.text, marginTop: 4},
  labelUnderValue: {...type.bodyStrong, color: colors.text, marginTop: 2},
  detail: {...type.body, color: colors.text, marginTop: space.xs},
  detailQuiet: {...type.body, color: colors.textSecondary, marginTop: space.xs},
  answerBox: {marginTop: 0},
  section: {
    ...type.caption,
    color: colors.textTertiary,
    marginTop: space.m,
    marginBottom: 4,
  },
  hint: {...type.caption, color: colors.textSecondary, marginTop: space.xs},
  sendHint: {...type.caption, color: colors.textTertiary, marginTop: space.s},
  actions: {marginTop: space.m, marginHorizontal: -space.s},
  row: {marginTop: space.xs / 2},
  rowInner: {
    minHeight: 40,
    paddingHorizontal: space.s,
    paddingVertical: space.xs,
    justifyContent: 'center',
  },
  rowText: {...type.bodyStrong, color: colors.text},
  rowQuiet: {...type.body, color: colors.textSecondary},
  onFocus: {color: colors.onFocus},
});
