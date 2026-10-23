import React, {ReactNode} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {FocusFrame} from '../components/FocusFrame';
import {sourceLine, uniqueSources, VERDICT_WORD} from '../analysis/cardText';
import {Source, Verdict} from '../analysis/schema';
import type {PhoneCard} from '../services/api';
import {Icon} from '../components/Icon';
import {colors, type} from '../theme';

export {domainOf, VERDICT_WORD} from '../analysis/cardText';

// Shared pieces for the co-viewer card details: the verdict as a word, a
// compact source list and "Send to phone".

export interface WidgetContext {
  now: number;
  onSeek: (t: number) => void;
  // Called with a spoiler-locked item; the panel shows the confirmation gate.
  onLocked: (label: string) => void;
  spoilersRevealed: boolean;
  firstFocus: boolean;
  // Present only when a phone is paired: every card detail, person and
  // answer offers "Send to phone".
  share?: ShareContext;
}

export type ShareStatus = 'idle' | 'sending' | 'sent' | 'failed';

// `key` names what is sent (a widget id, or an answer's key) for its status;
// the caller builds the phone card (services/phoneCards.ts).
export interface ShareContext {
  phoneName: string;
  status: (key: string) => ShareStatus;
  send: (key: string, card: PhoneCard) => void;
}

// The panel draws the kind label and headline above a detail, so a widget
// body is only its content.
export const WidgetShell = ({
  children,
}: {
  kind?: string;
  title?: string;
  children: ReactNode;
}) => <View>{children}</View>;

export const Disclaimer = ({text}: {text?: string}) =>
  text ? (
    <Text style={styles.disclaimer}>{text}</Text>
  ) : null;

// Only claims that did not hold take the accent; every other verdict is a
// quiet word.
export const alarming = (v?: Verdict) => v === 'DEBUNKED' || v === 'DISPUTED';

// The verdict as a word: secondary text, weight 600; the accent only for
// debunked and disputed. `onFocus`: drawn on the focus fill (black).
export const VerdictWord = ({
  verdict,
  onFocus = false,
}: {
  verdict?: Verdict;
  onFocus?: boolean;
}) => {
  if (!verdict || !VERDICT_WORD[verdict]) {
    return null;
  }
  return (
    <Text
      testID={`verdict-${verdict}`}
      accessibilityLabel={`Verdict: ${VERDICT_WORD[verdict]}`}
      numberOfLines={1}
      style={[
        styles.verdict,
        alarming(verdict) && styles.verdictAlarm,
        onFocus && styles.onFocusDim,
      ]}>
      {VERDICT_WORD[verdict]}
    </Text>
  );
};

// Kept for older call sites.
export const VerdictStamp = VerdictWord;

// The banner's small accent dot (debunked/disputed only, always beside words).
export const AccentDot = () => <View style={styles.dot} />;

// Up to three sources, "title · domain · date", each wrapped in full. Not
// focusable: the TV cannot open links.
export const SourceLines = ({
  sources,
  max = 3,
  label = true,
}: {
  sources?: Source[];
  max?: number;
  label?: boolean;
}) => {
  const list = uniqueSources(sources, max);
  return list.length ? (
    <View style={styles.sources}>
      {label ? <Text style={styles.sectionLabel}>Sources</Text> : null}
      {list.map((s) => (
        <Text key={s.url} style={styles.sourceLine}>
          {sourceLine(s)}
        </Text>
      ))}
    </View>
  ) : null;
};

export const SectionLabel = ({children}: {children: string}) => (
  <Text style={styles.sectionLabel}>{children}</Text>
);

// Not paired: a detail says once, quietly (never a button), how to get a
// Send to phone.
export const SEND_HINT = 'Link a phone from Home to send this to it.';

// "Send to phone" in a detail's action row, with its own confirmation.
export const ShareRow = ({
  shareKey,
  testID,
  title,
  card,
  share,
  onFocus,
  onBlur,
}: {
  shareKey: string;
  testID?: string;
  title: string;
  // Built on press, from what is on screen then.
  card: () => PhoneCard;
  share?: ShareContext;
  // The detail tracks its focused action (LEFT from the leftmost one closes).
  onFocus?: () => void;
  onBlur?: () => void;
}) => {
  if (!share) {
    return null;
  }
  const status = share.status(shareKey);
  const label =
    status === 'sending'
      ? 'Sending…'
      : status === 'sent'
      ? 'Sent'
      : status === 'failed'
      ? 'Try again'
      : 'Send to phone';
  return (
    <FocusFrame
      testID={testID ?? `share-${shareKey}`}
      accessibilityLabel={`${
        status === 'idle' ? `Send to ${share.phoneName}` : label
      }. ${title}`}
      variant="button"
      style={styles.action}
      contentStyle={styles.actionInner}
      onFocus={onFocus}
      onBlur={onBlur}
      onPress={
        status === 'sending' || status === 'sent'
          ? undefined
          : () => share.send(shareKey, card())
      }>
      {(focused) => (
        <View style={styles.shareRow} accessibilityLiveRegion="polite">
          <Icon
            name="phone"
            size={16}
            color={focused ? colors.onFocus : colors.text}
          />
          <Text
            numberOfLines={1}
            style={[styles.actionText, focused && styles.onFocus]}>
            {label}
          </Text>
        </View>
      )}
    </FocusFrame>
  );
};

export const styles = StyleSheet.create({
  primary: {...type.body, color: colors.text},
  strong: {...type.bodyStrong, color: colors.text},
  secondary: {...type.caption, color: colors.textSecondary, marginTop: 2},
  disclaimer: {...type.caption, color: colors.textTertiary, marginTop: 12},
  verdict: {...type.captionStrong, color: colors.textSecondary},
  verdictAlarm: {color: colors.accent},
  onFocus: {color: colors.onFocus},
  onFocusDim: {color: colors.onFocus, opacity: 0.62},
  dot: {width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent},
  sources: {marginTop: 16},
  sectionLabel: {...type.captionStrong, color: colors.textTertiary},
  sourceLine: {...type.caption, color: colors.textSecondary, marginTop: 2},
  action: {marginRight: 8, marginTop: 8},
  actionInner: {
    height: 40,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  actionText: {...type.bodyStrong, color: colors.text, marginLeft: 8},
  shareRow: {flexDirection: 'row', alignItems: 'center'},
});
