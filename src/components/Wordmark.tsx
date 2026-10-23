import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {colors} from '../theme';

// Two sibling Text nodes rather than nested Text: the template's index.js
// notes nested Text as a known problem on this runtime.
export const Wordmark = ({size = 28}: {size?: number}) => {
  const type = {fontSize: size, letterSpacing: Math.round(size * 0.32)};
  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel="StudioX"
      accessibilityRole="header">
      <Text style={[styles.word, type]}>STUDIO</Text>
      <Text style={[styles.word, type, styles.x]}>X</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  row: {flexDirection: 'row', alignItems: 'baseline'},
  word: {color: colors.text, fontWeight: '700'},
  x: {color: colors.brand},
});
