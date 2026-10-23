import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import Svg, {Circle, Line, Path} from '@amazon-devices/react-native-svg';
import {Explore} from '../analysis/schema';
import {FocusFrame, NextFocus} from '../components/FocusFrame';
import {Icon} from '../components/Icon';
import {colors, space, type} from '../theme';
import {isLocked, MapLayout, Neighbours, pinPoint} from './layout';
import {nodeMeta} from './mapData';
import {NodeCard} from './scene/NodeCard';
import {StoryPulse} from './scene/story';
import {MapTheme, Motif} from './themes';

interface Props {
  explore: Explore;
  layout: MapLayout;
  theme: MapTheme;
  width: number;
  height: number;
  playhead: number | null;
  // False while the detail sheet is open: the map stays visible, dimmed,
  // and out of the focus order.
  focusable: boolean;
  preferredId: string | null;
  neighbours: Neighbours;
  // Mounted node instances, for the explicit D-pad neighbours.
  resolve: (id: string | undefined) => View | undefined;
  register: (id: string, v: View | null) => void;
  onSelect: (id: string) => void;
  onFocusNode: (id: string) => void;
  onSim?: (simId: string) => void;
  // The story: the lit node, the pulse's path into it, and whether it runs.
  story?: {lit: string | null; step: number; path: number[]; running: boolean};
}

// The map, drawn natively from the computed layout over the scene's
// backdrop: SVG for connectors (red string, glowing links, dotted
// constellations…), the axis or date rail and stems; one focusable card per
// node. Nothing here animates on its own: the pulse moves only while the
// story plays, and no layer holding text is ever scaled.
export const MapCanvas = ({
  explore,
  layout,
  theme,
  width,
  height,
  playhead,
  focusable,
  preferredId,
  neighbours,
  resolve,
  register,
  onSelect,
  onFocusNode,
  onSim,
  story,
}: Props) => {
  const byId = new Map(explore.nodes.map((n) => [n.id, n]));
  const locked = (id: string) => {
    const n = byId.get(id);
    return !!n && isLocked(n, playhead, explore.suspense);
  };
  const next = (id: string): NextFocus => {
    const nb = neighbours[id] ?? {};
    const self = resolve(id);
    return {
      up: resolve(nb.up) ?? self,
      down: resolve(nb.down) ?? self,
      left: resolve(nb.left) ?? self,
      right: resolve(nb.right) ?? self,
    };
  };
  const withTime = playhead !== null;
  const motif = theme.motif;
  const plain = motif === 'plain';
  // The two ends of a visible contradiction take the accent on the axis.
  const conflictIds = new Set<string>();
  layout.edges.forEach((e) => {
    if (e.kind === 'contradicts' && !locked(e.from) && !locked(e.to)) {
      conflictIds.add(e.from);
      conflictIds.add(e.to);
    }
  });
  const sim = layout.simButton
    ? explore.sims.find((s) => s.id === layout.simButton?.simId)
    : undefined;
  const caseTimeline = motif === 'caseboard' && layout.kind === 'timeline';
  const stroke = strokeFor(motif, theme);

  return (
    <>
      <Svg
        width={width}
        height={height}
        style={StyleSheet.absoluteFill}
        pointerEvents="none">
        {caseTimeline ? (
          <CaseStrings layout={layout} theme={theme} locked={locked} />
        ) : (
          <>
            {layout.axis ? <Axis layout={layout} theme={theme} motif={motif} /> : null}
            {layout.stems?.map((s) => (
              <Line
                key={`stem-${s.id}`}
                x1={s.x}
                y1={s.y0}
                x2={s.x}
                y2={s.y1}
                stroke={plain ? colors.track : theme.line}
                strokeWidth={2}
              />
            ))}
            {layout.edges.map((e) => {
              if (!e.d) {
                return null;
              }
              const dim = locked(e.from) || locked(e.to);
              const conflict = !dim && e.kind === 'contradicts';
              const s = conflict ? stroke.conflict : dim ? stroke.dim : stroke.rest;
              return (
                <React.Fragment key={`edge-${e.from}-${e.to}`}>
                  {s.glow ? (
                    <Path d={e.d} stroke={s.glow} strokeWidth={7} strokeLinecap="round" fill="none" />
                  ) : null}
                  <Path
                    d={e.d}
                    stroke={s.color}
                    strokeOpacity={s.opacity}
                    strokeWidth={s.width}
                    strokeDasharray={s.dash}
                    strokeLinecap="round"
                    fill="none"
                  />
                  {e.arrow ? <Path d={e.arrow} fill={s.color} fillOpacity={s.opacity} /> : null}
                </React.Fragment>
              );
            })}
            {layout.stems?.map((s) => (
              <Circle
                key={`dot-${s.id}`}
                cx={s.x}
                cy={s.y1}
                r={4}
                fill={
                  locked(s.id)
                    ? plain
                      ? colors.textTertiary
                      : theme.line
                    : conflictIds.has(s.id)
                    ? plain
                      ? colors.accent
                      : theme.accent
                    : plain
                    ? colors.text
                    : theme.support
                }
              />
            ))}
          </>
        )}
      </Svg>

      {layout.edges.map((e) => {
        const dim = locked(e.from) || locked(e.to);
        if (!e.label || !e.labelBox || dim) {
          return null; // a label into a locked piece would spoil it
        }
        const conflict = e.kind === 'contradicts';
        const tagged = layout.kind === 'timeline';
        return (
          <View
            key={`label-${e.from}-${e.to}`}
            pointerEvents="none"
            testID={`map-edge-label-${e.from}-${e.to}`}
            style={[
              styles.edgeLabelBox,
              e.labelAlign === 'left' && styles.edgeLabelLeft,
              tagged && [
                styles.tag,
                {backgroundColor: plain ? colors.black : theme.bg},
                conflict && {borderColor: plain ? colors.accent : theme.accent},
              ],
              {
                left: e.labelBox.x,
                top: e.labelBox.y,
                width: e.labelBox.w,
                minHeight: e.labelBox.h,
              },
            ]}>
            <Text
              style={[
                styles.edgeLabel,
                {color: plain ? colors.textSecondary : theme.inkSoft},
                conflict && (plain ? styles.accent : {color: theme.ink}),
                e.labelAlign === 'left' && styles.textLeft,
              ]}>
              {e.label}
            </Text>
          </View>
        );
      })}

      {layout.headings.map((h) => (
        <Text
          key={h.id}
          style={[
            h.size === 'headline' ? styles.columnHeading : styles.heading,
            !plain && {color: h.size === 'headline' ? theme.ink : theme.inkSoft},
            {left: h.x, top: h.y, width: h.w},
          ]}>
          {h.title}
        </Text>
      ))}

      {story && story.running && story.path.length >= 4 ? (
        <StoryPulse
          path={story.path}
          step={story.step}
          running={story.running}
          color={theme.accent}
          halo={theme.accentSoft}
        />
      ) : null}

      {layout.nodes.map((p) => {
        const node = byId.get(p.id);
        if (!node) {
          return null;
        }
        return (
          <NodeCard
            key={p.id}
            node={node}
            placed={p}
            theme={theme}
            locked={locked(p.id)}
            compactLock={layout.kind === 'timeline'}
            meta={nodeMeta(node, withTime)}
            lit={story?.lit === p.id}
            focusable={focusable}
            preferred={focusable && preferredId === p.id}
            nextFocus={next(p.id)}
            register={register}
            onPress={() => onSelect(p.id)}
            onFocus={() => onFocusNode(p.id)}
          />
        );
      })}

      {layout.simButton && sim && onSim ? (
        <FocusFrame
          ref={(v) => register(`sim-${sim.id}`, v)}
          testID={`map-sim-${sim.id}`}
          accessibilityLabel={`Try it: ${sim.title}`}
          variant="button"
          focusable={focusable}
          nextFocus={next(`sim-${sim.id}`)}
          style={[
            styles.simButton,
            {
              left: layout.simButton.x,
              top: layout.simButton.y,
              minWidth: layout.simButton.w,
            },
          ]}
          contentStyle={styles.simInner}
          onFocus={() => onFocusNode(`sim-${sim.id}`)}
          onPress={() => onSim(sim.id)}>
          {(focused) => (
            <>
              <Icon
                name="play"
                size={16}
                color={focused ? colors.onFocus : colors.text}
              />
              <Text style={[styles.simText, focused && styles.onFocus]}>
                {`Try it: ${sim.title}`}
              </Text>
            </>
          )}
        </FocusFrame>
      ) : null}
    </>
  );
};

interface Stroke {
  color: string;
  opacity: number;
  width: number;
  dash?: string;
  glow?: string; // a wide, soft stroke under the line
}

// How each scene draws a connector: red string, dotted constellation,
// glowing link, ledger rule, archive thread.
function strokeFor(motif: Motif, t: MapTheme): {rest: Stroke; dim: Stroke; conflict: Stroke} {
  const dim: Stroke = {color: motif === 'plain' ? colors.track : t.line, opacity: 0.6, width: 1.5};
  switch (motif) {
    case 'caseboard':
      return {
        rest: {color: t.accent, opacity: 0.85, width: 2},
        dim,
        conflict: {color: t.accent, opacity: 1, width: 3.5},
      };
    case 'nightsky':
      return {
        rest: {color: t.support, opacity: 0.55, width: 2, dash: '1 6'},
        dim,
        conflict: {color: t.accent, opacity: 1, width: 2.5},
      };
    case 'signal':
      return {
        rest: {color: t.accent, opacity: 0.9, width: 1.5, glow: t.accentSoft},
        dim,
        conflict: {color: t.support, opacity: 1, width: 2, glow: t.accentSoft},
      };
    case 'ledger':
      return {
        rest: {color: t.inkSoft, opacity: 0.7, width: 1.5},
        dim,
        conflict: {color: t.support, opacity: 1, width: 2.5},
      };
    case 'archive':
      return {
        rest: {color: t.support, opacity: 0.5, width: 1.5, dash: '6 4'},
        dim,
        conflict: {color: t.accent, opacity: 1, width: 2.5},
      };
    case 'plain':
      return {
        rest: {color: colors.textTertiary, opacity: 1, width: 2},
        dim: {color: colors.track, opacity: 1, width: 2},
        conflict: {color: colors.accent, opacity: 1, width: 3},
      };
  }
}

// The timeline's axis: a plain line, or the archive's date rail (a double
// rail with a tick at every event).
const Axis = ({layout, theme, motif}: {layout: MapLayout; theme: MapTheme; motif: Motif}) => {
  const a = layout.axis!;
  if (motif === 'archive') {
    const ticks = (layout.stems ?? []).map((s) => `M${s.x} ${a.y - 7}V${a.y + 7}`).join(' ');
    return (
      <>
        <Path
          d={`M${a.x0} ${a.y - 3}H${a.x1} M${a.x0} ${a.y + 3}H${a.x1}`}
          stroke={theme.support}
          strokeOpacity={0.4}
          strokeWidth={1.5}
        />
        <Path d={ticks} stroke={theme.support} strokeOpacity={0.6} strokeWidth={1.5} />
      </>
    );
  }
  return (
    <Line
      x1={a.x0}
      y1={a.y}
      x2={a.x1}
      y2={a.y}
      stroke={motif === 'plain' ? colors.track : theme.line}
      strokeWidth={2}
    />
  );
};

// The case board on a timeline: red string from pin to pin in time order,
// and the contradiction as a taut, heavier string.
const CaseStrings = ({
  layout,
  theme,
  locked,
}: {
  layout: MapLayout;
  theme: MapTheme;
  locked: (id: string) => boolean;
}) => {
  const at = new Map(layout.nodes.map((p) => [p.id, p]));
  const conflicts = layout.edges.filter(
    (e) => e.kind === 'contradicts' && !locked(e.from) && !locked(e.to),
  );
  const isConflict = (a: string, b: string) =>
    conflicts.some((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a));
  const chain = layout.chain ?? [];
  const extra = conflicts.filter(
    (e) => !chain.some((c) => (c.from === e.from && c.to === e.to) || (c.from === e.to && c.to === e.from)),
  );
  return (
    <>
      {chain.map((c) => {
        const dim = locked(c.from) || locked(c.to);
        const hot = isConflict(c.from, c.to);
        return (
          <Path
            key={`string-${c.from}-${c.to}`}
            d={c.d}
            stroke={dim ? theme.line : theme.accent}
            strokeOpacity={dim ? 0.35 : hot ? 1 : 0.8}
            strokeWidth={hot ? 3.5 : 2}
            strokeDasharray={dim ? '4 6' : undefined}
            strokeLinecap="round"
            fill="none"
          />
        );
      })}
      {extra.map((e) => {
        const a = pinPoint(at.get(e.from)!);
        const b = pinPoint(at.get(e.to)!);
        const midY = Math.round((a.y + b.y) / 2) + 36;
        return (
          <Path
            key={`string-${e.from}-${e.to}`}
            d={`M${a.x} ${a.y} Q${Math.round((a.x + b.x) / 2)} ${midY} ${b.x} ${b.y}`}
            stroke={theme.accent}
            strokeWidth={3.5}
            strokeLinecap="round"
            fill="none"
          />
        );
      })}
    </>
  );
};

const styles = StyleSheet.create({
  heading: {
    ...type.caption,
    position: 'absolute',
    color: colors.textSecondary,
  },
  columnHeading: {
    ...type.headline,
    position: 'absolute',
    color: colors.text,
  },
  edgeLabelBox: {position: 'absolute', alignItems: 'center', justifyContent: 'center'},
  tag: {
    borderRadius: 4,
    paddingHorizontal: space.xs - 1, // with the border: the 8 dp measured
    borderWidth: 1,
    borderColor: 'transparent',
  },
  edgeLabel: {...type.caption, textAlign: 'center'},
  accent: {color: colors.accent},
  edgeLabelLeft: {alignItems: 'flex-start'},
  textLeft: {textAlign: 'left'},
  simButton: {position: 'absolute'},
  simInner: {
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.m,
  },
  simText: {...type.bodyStrong, color: colors.text, marginLeft: space.xs},
  onFocus: {color: colors.onFocus},
});
