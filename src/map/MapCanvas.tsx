import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import Svg, {Circle, Line, Path} from '@amazon-devices/react-native-svg';
import {Explore, ExploreNode} from '../analysis/schema';
import {FocusFrame, NextFocus} from '../components/FocusFrame';
import {Icon} from '../components/Icon';
import {colors, numeric, radius, space, type} from '../theme';
import {VerdictWord} from '../widgets/parts';
import {isLocked, MapLayout, Neighbours, PlacedNode} from './layout';
import {nodeMeta, valueText} from './mapData';

interface Props {
  explore: Explore;
  layout: MapLayout;
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
}

// The map, drawn natively from the computed layout: SVG for connectors, the
// axis and stems; one focusable View per node. Nothing here animates on its
// own, and no layer holding text is ever scaled.
export const MapCanvas = ({
  explore,
  layout,
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
}: Props) => {
  const byId = new Map(explore.nodes.map((n) => [n.id, n]));
  const locked = (id: string) => {
    const n = byId.get(id);
    return !!n && isLocked(n, playhead);
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

  return (
    <>
      <Svg
        width={width}
        height={height}
        style={StyleSheet.absoluteFill}
        pointerEvents="none">
        {layout.axis ? (
          <Line
            x1={layout.axis.x0}
            y1={layout.axis.y}
            x2={layout.axis.x1}
            y2={layout.axis.y}
            stroke={colors.track}
            strokeWidth={2}
          />
        ) : null}
        {layout.stems?.map((s) => (
          <Line
            key={`stem-${s.id}`}
            x1={s.x}
            y1={s.y0}
            x2={s.x}
            y2={s.y1}
            stroke={colors.track}
            strokeWidth={2}
          />
        ))}
        {layout.edges.map((e) => {
          const dim = locked(e.from) || locked(e.to);
          const accent = !dim && e.kind === 'contradicts';
          const stroke = accent
            ? colors.accent
            : dim
            ? colors.track
            : colors.textTertiary;
          return (
            <React.Fragment key={`edge-${e.from}-${e.to}`}>
              {e.d ? (
              <Path
                d={e.d}
                stroke={stroke}
                strokeWidth={accent ? 3 : 2}
                fill="none"
              />
              ) : null}
              {e.arrow ? <Path d={e.arrow} fill={stroke} /> : null}
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
                ? colors.textTertiary
                : conflictIds.has(s.id)
                ? colors.accent
                : colors.text
            }
          />
        ))}
      </Svg>

      {layout.edges.map((e) => {
        const dim = locked(e.from) || locked(e.to);
        if (!e.label || !e.labelBox || dim) {
          return null; // a label into a locked piece would spoil it
        }
        const accent = e.kind === 'contradicts';
        return (
          <View
            key={`label-${e.from}-${e.to}`}
            pointerEvents="none"
            style={[
              styles.edgeLabelBox,
              e.labelAlign === 'left' && styles.edgeLabelLeft,
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
                accent && styles.accent,
                e.labelAlign === 'left' && styles.textLeft,
              ]}
              numberOfLines={e.labelBox.h > 20 ? 2 : 1}>
              {e.label}
            </Text>
          </View>
        );
      })}

      {layout.headings.map((h) => (
        <Text
          key={h.id}
          style={[
            layout.kind === 'columns' ? styles.columnHeading : styles.heading,
            {left: h.x, top: h.y, width: h.w},
          ]}
          numberOfLines={1}>
          {h.title}
        </Text>
      ))}

      {layout.nodes.map((p) => {
        const node = byId.get(p.id);
        if (!node) {
          return null;
        }
        return (
          <MapNode
            key={p.id}
            node={node}
            placed={p}
            locked={locked(p.id)}
            meta={nodeMeta(node, withTime)}
            showValue={explore.layout === 'compare'}
            compactLock={layout.kind === 'timeline'}
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
              <Text
                style={[styles.simText, focused && styles.onFocus]}
                numberOfLines={1}>
                {`Try it: ${sim.title}`}
              </Text>
            </>
          )}
        </FocusFrame>
      ) : null}
    </>
  );
};

interface NodeProps {
  node: ExploreNode;
  placed: PlacedNode;
  locked: boolean;
  meta: string;
  showValue: boolean;
  // Timeline: a locked event is a short box hugging the axis, so what is
  // known so far reads first.
  compactLock?: boolean;
  focusable: boolean;
  preferred: boolean;
  nextFocus: NextFocus;
  register: (id: string, v: View | null) => void;
  onPress: () => void;
  onFocus: () => void;
}

const MapNode = ({
  node,
  placed,
  locked,
  meta,
  showValue,
  compactLock = false,
  focusable,
  preferred,
  nextFocus,
  register,
  onPress,
  onFocus,
}: NodeProps) => {
  const LOCK_H = 48;
  const short = locked && compactLock && placed.h > LOCK_H;
  const h = short ? LOCK_H : placed.h;
  const y = short && placed.side === 'above' ? placed.y + placed.h - LOCK_H : placed.y;
  const value = showValue && node.value ? valueText(node.value) : null;
  const label = locked
    ? 'Locked. Keep watching to unlock this piece.'
    : `${node.label}. ${meta}${
        node.verdict ? `. Verdict: ${node.verdict.toLowerCase()}` : ''
      }${value ? `. ${value}` : ''}. Select to open.`;
  return (
    <FocusFrame
      ref={(v) => register(node.id, v)}
      testID={`map-node-${node.id}`}
      accessibilityLabel={label}
      variant="button"
      focusable={focusable}
      hasTVPreferredFocus={preferred}
      nextFocus={nextFocus}
      style={[
        styles.node,
        {left: placed.x, top: y, width: placed.w, height: h},
      ]}
      contentStyle={[styles.nodeInner, locked && styles.nodeLocked]}
      onFocus={onFocus}
      onPress={onPress}>
      {(focused) =>
        locked ? (
          <View style={styles.lockedRow}>
            <Icon
              name="lock"
              size={16}
              color={focused ? colors.onFocus : colors.textSecondary}
            />
            <Text
              style={[styles.lockedText, focused && styles.onFocus]}
              numberOfLines={1}>
              Keep watching
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.metaRow}>
              <Text
                style={[styles.meta, focused && styles.onFocusDim]}
                numberOfLines={1}>
                {meta}
              </Text>
              {node.verdict ? (
                <>
                  <Text style={[styles.meta, focused && styles.onFocusDim]}>
                    {'  ·  '}
                  </Text>
                  <VerdictWord
                    verdict={node.verdict}
                    onFocus={focused}
                  />
                </>
              ) : null}
            </View>
            {value ? (
              <Text
                style={[styles.value, focused && styles.onFocus]}
                numberOfLines={1}>
                {value}
              </Text>
            ) : null}
            <Text
              style={[styles.label, focused && styles.onFocus]}
              numberOfLines={placed.lines}>
              {node.label}
            </Text>
          </>
        )
      }
    </FocusFrame>
  );
};

const styles = StyleSheet.create({
  node: {position: 'absolute'},
  nodeInner: {
    flex: 1,
    paddingHorizontal: space.s,
    paddingVertical: space.s,
    borderRadius: radius.row,
  },
  nodeLocked: {justifyContent: 'center', backgroundColor: colors.panel},
  metaRow: {flexDirection: 'row', alignItems: 'center'},
  meta: {...type.caption, ...numeric, color: colors.textSecondary, flexShrink: 1},
  value: {...type.title, ...numeric, color: colors.text, marginTop: 2},
  label: {...type.bodyStrong, color: colors.text, marginTop: 4},
  lockedRow: {flexDirection: 'row', alignItems: 'center'},
  lockedText: {
    ...type.caption,
    color: colors.textSecondary,
    marginLeft: space.xs,
  },
  onFocus: {color: colors.onFocus},
  onFocusDim: {color: colors.onFocus, opacity: 0.62},
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
  edgeLabelBox: {position: 'absolute', alignItems: 'center'},
  edgeLabel: {...type.caption, color: colors.textSecondary, textAlign: 'center'},
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
});
