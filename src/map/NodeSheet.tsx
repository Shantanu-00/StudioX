import React, {useEffect, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {TVFocusGuideView} from '@amazon-devices/react-native-kepler';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from '@amazon-devices/react-native-reanimated';
import {formatTime} from '../analysis/composer';
import {Answer, ExploreNode, ExploreSim, Source} from '../analysis/schema';
import {FocusFrame} from '../components/FocusFrame';
import {colors, numeric, space, type} from '../theme';
import {SourceLines, VerdictWord} from '../widgets/parts';
import {useFocusOnMount} from './focus';
import {MapAnswer, SendStatus, sendLabel} from './useMapActions';

export const SHEET_W = 360;
const SLIDE_MS = 250;

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
  onPlay: () => void;
  onTry: () => void;
  onAsk: (question: string, prepared: Answer | null, key: string) => void;
  onSend: () => void;
  onKeepWatching: () => void;
  onCloseAnswer: () => void;
}

export const LIVE_QUESTION = 'What should I know about this?';

// A node opened: a solid sheet on the right 360 dp, the map still visible
// (dimmed) on its left. Focus is trapped inside; BACK closes the answer,
// then the sheet (MapScreen owns the chain).
export const NodeSheet = (props: Props) => {
  const x = useSharedValue(SHEET_W);
  useEffect(() => {
    x.value = withTiming(0, {
      duration: SLIDE_MS,
      easing: Easing.out(Easing.cubic),
    });
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
        {props.answer ? (
          <AnswerBody answer={props.answer} onBack={props.onCloseAnswer} />
        ) : props.locked ? (
          <LockedBody onKeepWatching={props.onKeepWatching} hasVideo={props.hasVideo} />
        ) : (
          <NodeBody {...props} />
        )}
      </TVFocusGuideView>
    </Animated.View>
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
  onPlay,
  onTry,
  onAsk,
  onSend,
}: Props) => {
  const when = [
    node.when,
    hasVideo && node.t !== null ? `Said at ${formatTime(node.t)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const rows: Array<{key: string; label: string; a11y: string; onPress: () => void}> = [];
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
  const first = focusAction ?? rows[0]?.key ?? asks[0]?.key ?? (paired ? 'send' : null);
  return (
    <View style={styles.body}>
      <View style={styles.metaRow}>
        {when ? (
          <Text style={styles.meta} numberOfLines={1}>
            {when}
          </Text>
        ) : null}
        {node.verdict ? (
          <>
            {when ? <Text style={styles.meta}>{'  ·  '}</Text> : null}
            <VerdictWord verdict={node.verdict} />
          </>
        ) : null}
      </View>
      <Text style={styles.headline} numberOfLines={2}>
        {node.label}
      </Text>
      {node.detail ? (
        <Text style={styles.detail} numberOfLines={4}>
          {node.detail}
        </Text>
      ) : null}
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
        {asks.length ? (
          <Text style={styles.section} numberOfLines={1}>
            Ask about this
          </Text>
        ) : null}
        {asks.map((r) => (
          <ActionRow
            key={r.key}
            testID={`sheet-${r.key}`}
            label={r.label}
            accessibilityLabel={r.a11y}
            preferred={first === r.key}
            lines={2}
            quiet
            onPress={r.onPress}
          />
        ))}
        {paired && asks.length ? (
          <Text style={styles.hint} numberOfLines={1}>
            Or ask by voice on your phone
          </Text>
        ) : null}
        {paired ? (
          <ActionRow
            testID="sheet-send"
            label={sendLabel(sendStatus)}
            accessibilityLabel={`${sendLabel(sendStatus)}: ${node.label}`}
            preferred={first === 'send'}
            onPress={sendStatus === 'sending' || sendStatus === 'sent' ? undefined : onSend}
          />
        ) : null}
      </View>
    </View>
  );
};

const LockedBody = ({
  onKeepWatching,
  hasVideo,
}: {
  onKeepWatching: () => void;
  hasVideo: boolean;
}) => (
  <View style={styles.body}>
    <Text style={styles.meta}>Later in the episode</Text>
    <Text style={styles.headline} numberOfLines={2}>
      Keep watching
    </Text>
    <Text style={styles.detail} numberOfLines={3}>
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

const AnswerBody = ({answer, onBack}: {answer: MapAnswer; onBack: () => void}) => {
  const [showSources, setShowSources] = useState(false);
  const loading = answer.status === 'loading';
  const sources: Source[] = answer.sources.slice(0, 3);
  return (
    <View style={styles.body} testID="map-answer">
      <Text style={styles.meta} numberOfLines={1}>
        {`${answer.live ? 'Live answer' : 'Prepared answer'} · AI, not the hosts`}
      </Text>
      <Text style={styles.headline} numberOfLines={2}>
        {answer.question}
      </Text>
      <View accessibilityLiveRegion="polite" style={styles.answerBox}>
        {loading ? (
          <Text style={styles.detailQuiet}>Asking the co-viewer…</Text>
        ) : (
          <Text style={styles.detail} numberOfLines={showSources ? 3 : 5}>
            {answer.text}
          </Text>
        )}
        {answer.note ? (
          <Text style={styles.hint} numberOfLines={2}>
            {answer.note}
          </Text>
        ) : null}
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
          onPress={onBack}
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
  lines = 1,
  quiet = false,
}: {
  testID: string;
  label: string;
  accessibilityLabel: string;
  preferred: boolean;
  onPress?: () => void;
  lines?: number;
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
          ]}
          numberOfLines={lines}>
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
  inner: {flex: 1, padding: space.l},
  body: {flex: 1},
  metaRow: {flexDirection: 'row', alignItems: 'center'},
  meta: {...type.caption, ...numeric, color: colors.textSecondary},
  headline: {...type.headline, color: colors.text, marginTop: 4},
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
