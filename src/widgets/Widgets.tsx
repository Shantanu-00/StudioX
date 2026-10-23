import React, {useState} from 'react';
import {Image, StyleSheet, Text, View} from 'react-native';
import Svg, {Circle, Line, Rect} from '@amazon-devices/react-native-svg';
import {formatTime, WINDOW_AFTER} from '../analysis/composer';
import {firstSentence, initialsOf, whyOf} from '../analysis/cardText';
import {
  ClaimWidget,
  DossierWidget,
  EntityListWidget,
  ProtocolWidget,
  RelationGraphWidget,
  TimelineWidget,
} from '../analysis/schema';
import {Icon} from '../components/Icon';
import {colors, numeric, type} from '../theme';
import {
  Disclaimer,
  SectionLabel,
  SourceLines,
  WidgetContext,
  styles as p,
} from './parts';

// The expanded body of each co-viewer card, drawn under the panel's
// headline. Nothing here is focusable: the detail view owns its actions
// (Jump to, Send to phone, Show spoilers). Every list is bounded so a detail
// never runs past the panel.

const BODY_W = 312; // panel 360 − 2 × 24 padding

// A claim: the claim (when a curator headline sits above it), who said it
// and when, the reason for the verdict, and up to three sources.
export const ClaimCard = ({w}: {w: ClaimWidget; ctx?: WidgetContext}) => (
  <View>
    {w.headline ? (
      <Text style={p.primary} numberOfLines={3}>
        “{w.claim.replace(/^["“]+|["”]+$/g, '')}”
      </Text>
    ) : null}
    <View style={local.metaRow}>
      <Text style={local.meta} numberOfLines={1}>
        {w.speaker}
      </Text>
      {w.evidence[0] ? (
        <Text style={[local.meta, local.metaTime]}>
          {formatTime(w.evidence[0].t0)}
        </Text>
      ) : null}
    </View>
    <View style={local.block}>
      <SectionLabel>Why</SectionLabel>
      <Text style={p.primary} numberOfLines={3}>
        {whyOf(w)}
      </Text>
    </View>
    <SourceLines sources={w.sources} />
  </View>
);

// Facts heard so far (the last three), else the first three.
export function factsAt(w: DossierWidget, now: number) {
  const heard = w.facts.filter(
    (f) => !f.evidence || f.evidence.t0 <= now + WINDOW_AFTER,
  );
  return (heard.length ? heard.slice(-3) : w.facts.slice(0, 3)).map((f) => ({
    ...f,
    text: firstSentence(f.text),
  }));
}

// A person: portrait, name, role, up to three facts with their timestamps
// and the photo credit.
export const DossierCard = ({
  w,
  ctx,
}: {
  w: DossierWidget;
  ctx: WidgetContext;
}) => (
  <View>
    <View style={local.personHead}>
      <Portrait name={w.name} url={w.image?.url} size={64} />
      <View style={local.personText}>
        <Text style={local.personName} numberOfLines={1}>
          {w.name}
        </Text>
        <Text style={local.meta} numberOfLines={2}>
          {w.role}
        </Text>
      </View>
    </View>
    {factsAt(w, ctx.now).map((f, i) => (
      <View key={i} style={local.fact}>
        <Text style={[p.primary, local.factText]} numberOfLines={2}>
          {f.text}
        </Text>
        {f.evidence ? (
          <Text style={[local.meta, local.factTime]}>
            {formatTime(f.evidence.t0)}
          </Text>
        ) : null}
      </View>
    ))}
    {w.image ? (
      <Text style={local.credit} numberOfLines={1}>
        {`Photo: ${w.image.credit}`}
      </Text>
    ) : null}
  </View>
);

// A round portrait (https only); initials on a neutral circle if there is no
// image or it fails to load. Explicit size, decoded at 2× for 1080p.
export const Portrait = ({
  name,
  url,
  size,
}: {
  name: string;
  url?: string;
  size: number;
}) => {
  const [failed, setFailed] = useState(false);
  const round = {width: size, height: size, borderRadius: size / 2};
  if (!url || failed) {
    return (
      <View style={[local.initials, round]}>
        <Text style={local.initialsText}>{initialsOf(name)}</Text>
      </View>
    );
  }
  return (
    <Image
      testID="dossier-portrait"
      accessibilityLabel={`Portrait of ${name}`}
      source={{uri: url, width: size * 2, height: size * 2}}
      style={[local.portrait, round]}
      resizeMode="cover"
      onError={() => setFailed(true)}
    />
  );
};

// Up to five events around the playhead. Events ahead of what the viewer
// has heard stay hidden until they choose to reveal them.
export const TimelineCard = ({
  w,
  ctx,
}: {
  w: TimelineWidget;
  ctx: WidgetContext;
}) => {
  const isLocked = (e: TimelineWidget['events'][number]) =>
    !ctx.spoilersRevealed && e.evidence.t0 > ctx.now + WINDOW_AFTER;
  const heard = w.events.filter((e) => !isLocked(e));
  const ahead = w.events.filter(isLocked);
  const shown = [...heard.slice(-4), ...ahead.slice(0, 1)].slice(-5);
  return (
    <View>
      {shown.map((e) =>
        isLocked(e) ? (
          <View key={e.id} style={local.event}>
            <View style={local.lockRow}>
              <Icon name="lock" size={14} color={colors.textTertiary} />
              <Text style={[local.meta, local.lockText]} numberOfLines={1}>
                {`${e.when} · Ahead in the story`}
              </Text>
            </View>
          </View>
        ) : (
          <View key={e.id} style={local.event}>
            <View style={local.eventHead}>
              <Text style={local.when} numberOfLines={1}>
                {e.when}
              </Text>
              {e.kind === 'conflict' ? (
                <Text style={local.tag}>Conflict</Text>
              ) : e.kind === 'claim' ? (
                <Text style={local.tag}>Claimed</Text>
              ) : null}
            </View>
            <Text style={p.primary} numberOfLines={2}>
              {e.label}
            </Text>
          </View>
        ),
      )}
    </View>
  );
};

export const timelineHasLocked = (w: TimelineWidget, ctx: WidgetContext) =>
  !ctx.spoilersRevealed &&
  w.events.some((e) => e.evidence.t0 > ctx.now + WINDOW_AFTER);

const GRAPH_H = 150;
const PAD_X = 48;
const PAD_Y = 16;

// Who is connected to whom. Conflicting links are solid and heavier;
// ordinary ones dashed. No colour carries meaning.
export const RelationGraphCard = ({w}: {w: RelationGraphWidget}) => {
  // Whole dp only, so labels placed from these never land between pixels.
  const pos = (n: RelationGraphWidget['nodes'][number]) => ({
    x: Math.round(PAD_X + n.x * (BODY_W - PAD_X * 2)),
    y: Math.round(PAD_Y + n.y * (GRAPH_H - PAD_Y * 2)),
  });
  const byId = new Map(w.nodes.map((n) => [n.id, n]));
  return (
    <View style={local.graph} accessible accessibilityLabel={describeGraph(w)}>
      <Svg width={BODY_W} height={GRAPH_H}>
        {w.edges.map((e) => {
          const a = pos(byId.get(e.from)!);
          const b = pos(byId.get(e.to)!);
          return (
            <Line
              key={`${e.from}-${e.to}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={e.conflict ? colors.text : colors.textTertiary}
              strokeWidth={e.conflict ? 2 : 1}
              strokeDasharray={e.conflict ? undefined : '3,3'}
            />
          );
        })}
        {w.nodes.map((n) => {
          const {x, y} = pos(n);
          return n.kind === 'person' ? (
            <Circle key={n.id} cx={x} cy={y} r={6} fill={colors.text} />
          ) : (
            <Rect
              key={n.id}
              x={x - 4}
              y={y - 4}
              width={8}
              height={8}
              fill={colors.textSecondary}
            />
          );
        })}
      </Svg>
      {w.nodes.map((n) => {
        const {x, y} = pos(n);
        return (
          <Text
            key={n.id}
            numberOfLines={1}
            style={[
              local.nodeLabel,
              n.kind === 'person' && local.nodeLabelPerson,
              {left: x - 50, top: y + 8},
            ]}>
            {n.label}
          </Text>
        );
      })}
    </View>
  );
};

const describeGraph = (w: RelationGraphWidget) =>
  `${w.title}. ` +
  w.edges
    .map((e) => {
      const from = w.nodes.find((n) => n.id === e.from)?.label;
      const to = w.nodes.find((n) => n.id === e.to)?.label;
      return `${from}, ${e.label}, ${to}`;
    })
    .join('. ');

// Things named in the episode (compounds, books…), at most four, each with
// what was said about it when that differs from the line above.
export const EntityListCard = ({w}: {w: EntityListWidget; ctx?: WidgetContext}) => {
  const items = w.items.slice(0, 4);
  return (
    <View>
      {items.map((it, i) => (
        <View key={`${it.name}-${i}`} style={local.item}>
          <View style={local.itemHead}>
            <Text style={[p.strong, local.itemName]} numberOfLines={1}>
              {it.name}
            </Text>
            {it.dose ? <Text style={local.meta}>{it.dose}</Text> : null}
          </View>
          {i === 0 || items[i - 1].asSaid !== it.asSaid ? (
            <Text style={local.meta} numberOfLines={2}>
              {it.asSaid}
            </Text>
          ) : null}
        </View>
      ))}
      {w.items.length > items.length ? (
        <Text style={local.more}>{`${w.items.length - items.length} more`}</Text>
      ) : null}
      <Disclaimer text={w.disclaimer} />
    </View>
  );
};

// A routine: up to five numbered steps, one line each with its detail.
export const ProtocolCard = ({w}: {w: ProtocolWidget; ctx?: WidgetContext}) => {
  const steps = w.steps.slice(0, 5);
  return (
    <View>
      {steps.map((s, i) => (
        <View key={`${s.label}-${i}`} style={local.step}>
          <Text style={local.stepIndex}>{i + 1}</Text>
          <View style={local.stepBody}>
            <Text style={p.strong} numberOfLines={1}>
              {s.label}
            </Text>
            <Text style={local.meta} numberOfLines={1}>
              {s.detail}
            </Text>
          </View>
        </View>
      ))}
      {w.steps.length > steps.length ? (
        <Text style={local.more}>
          {`${w.steps.length - steps.length} more steps`}
        </Text>
      ) : null}
      <Disclaimer text={w.disclaimer} />
    </View>
  );
};

const local = StyleSheet.create({
  meta: {...type.caption, color: colors.textSecondary},
  metaRow: {flexDirection: 'row', marginTop: 8},
  metaTime: {...numeric, marginLeft: 8, color: colors.textTertiary},
  block: {marginTop: 16},
  personHead: {flexDirection: 'row', alignItems: 'center', marginBottom: 8},
  personText: {flex: 1, marginLeft: 16},
  personName: {...type.headline, color: colors.text},
  fact: {flexDirection: 'row', alignItems: 'flex-start', marginTop: 12},
  factText: {flex: 1},
  factTime: {...numeric, marginLeft: 12, marginTop: 2, color: colors.textTertiary},
  credit: {...type.caption, color: colors.textTertiary, marginTop: 16},
  portrait: {backgroundColor: colors.card},
  initials: {
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initialsText: {...type.bodyStrong, color: colors.textSecondary},
  event: {marginBottom: 12},
  eventHead: {flexDirection: 'row', alignItems: 'center'},
  when: {...type.captionStrong, ...numeric, color: colors.textSecondary},
  tag: {...type.caption, color: colors.textTertiary, marginLeft: 8},
  lockRow: {flexDirection: 'row', alignItems: 'center'},
  lockText: {marginLeft: 8, color: colors.textTertiary},
  graph: {width: BODY_W, height: GRAPH_H + 16},
  nodeLabel: {
    ...type.caption,
    position: 'absolute',
    width: 100,
    textAlign: 'center',
    color: colors.textSecondary,
  },
  nodeLabelPerson: {...type.captionStrong, color: colors.text},
  item: {marginBottom: 12},
  itemHead: {flexDirection: 'row', alignItems: 'baseline'},
  itemName: {flexShrink: 1, marginRight: 8},
  more: {...type.caption, color: colors.textTertiary},
  step: {flexDirection: 'row', marginBottom: 12},
  stepIndex: {
    ...type.bodyStrong,
    ...numeric,
    color: colors.textTertiary,
    width: 24,
  },
  stepBody: {flex: 1},
});
