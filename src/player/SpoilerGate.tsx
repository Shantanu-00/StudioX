import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {TVFocusGuideView} from '@amazon-devices/react-native-kepler';
import {FocusFrame} from '../components/FocusFrame';
import {colors, radius, space, type} from '../theme';

interface Props {
  onReveal: () => void;
  onStay: () => void;
}

// Focus-trapped confirmation before the co-viewer shows events the viewer has
// not reached yet. BACK closes it (handled by the player's back chain).
export const SpoilerGate = ({onReveal, onStay}: Props) => (
  <View style={styles.scrim} accessibilityViewIsModal>
    <TVFocusGuideView
      trapFocusUp
      trapFocusDown
      trapFocusLeft
      trapFocusRight
      style={styles.box}>
      <Text style={styles.title}>Look ahead in the story?</Text>
      <Text style={styles.body}>
        This shows later events on the timeline for this episode.
      </Text>
      <View style={styles.actions}>
        <FocusFrame
          testID="spoiler-stay"
          accessibilityLabel="Stay spoiler-free"
          hasTVPreferredFocus
          variant="button"
          style={styles.button}
          contentStyle={styles.buttonInner}
          onPress={onStay}>
          {(focused) => (
            <Text
              style={[styles.buttonText, focused && styles.buttonTextFocused]}>
              Stay spoiler-free
            </Text>
          )}
        </FocusFrame>
        <FocusFrame
          testID="spoiler-reveal"
          accessibilityLabel="Reveal what happens next"
          variant="button"
          style={styles.button}
          contentStyle={styles.buttonInner}
          onPress={onReveal}>
          {(focused) => (
            <Text
              style={[styles.buttonText, focused && styles.buttonTextFocused]}>
              Reveal
            </Text>
          )}
        </FocusFrame>
      </View>
    </TVFocusGuideView>
  </View>
);

const styles = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  box: {
    width: 400,
    padding: space.l,
    backgroundColor: colors.panel,
    borderRadius: radius.banner,
  },
  title: {...type.headline, color: colors.text},
  body: {...type.body, color: colors.textSecondary, marginTop: space.xs},
  actions: {flexDirection: 'row', marginTop: space.l},
  button: {marginRight: space.s},
  buttonInner: {height: 40, paddingHorizontal: space.m, justifyContent: 'center'},
  buttonText: {...type.bodyStrong, color: colors.text},
  buttonTextFocused: {color: colors.onFocus},
});
