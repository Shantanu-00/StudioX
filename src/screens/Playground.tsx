import React, {useEffect, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {
  TVFocusGuideView,
  useTVEventHandler,
} from '@amazon-devices/react-native-kepler';

// A small sandbox for learning the Vega remote, focus and re-render model.
// Switch the app between this and the helloWorld screen in index.js.

interface CardData {
  id: string;
  label: string;
  color: string;
}

const CARDS: CardData[] = [
  {id: 'a', label: 'Alpha', color: '#0074B8'},
  {id: 'b', label: 'Bravo', color: '#2E7D32'},
  {id: 'c', label: 'Charlie', color: '#6A1B9A'},
  {id: 'd', label: 'Delta', color: '#C62828'},
  {id: 'e', label: 'Echo', color: '#00838F'},
  {id: 'f', label: 'Foxtrot', color: '#EF6C00'},
];

export const Playground = () => {
  const [focusedId, setFocusedId] = useState<string>('a');
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [lastKey, setLastKey] = useState<string>('none yet');
  const [keyTotal, setKeyTotal] = useState<number>(0);
  const [seconds, setSeconds] = useState<number>(0);

  // Remote key events (up, down, left, right, select, menu, playPause, ...).
  useTVEventHandler((event) => {
    setLastKey(String(event.eventType));
    setKeyTotal((n) => n + 1);
  });

  // A ticking counter makes re-renders visible without any interaction.
  useEffect(() => {
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const press = (id: string) =>
    setCounts((prev) => ({...prev, [id]: (prev[id] ?? 0) + 1}));

  const reset = () => setCounts({});

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>StudioX Playground</Text>
        <Text style={styles.subtitle}>
          Move with the arrow keys, press Enter to count, Esc to go back.
        </Text>
      </View>

      <View style={styles.statusRow}>
        <Text style={styles.status}>Last key: {lastKey}</Text>
        <Text style={styles.status}>Keys pressed: {keyTotal}</Text>
        <Text style={styles.status}>Focused: {focusedId.toUpperCase()}</Text>
        <Text style={styles.status}>Uptime: {seconds}s</Text>
      </View>

      <TVFocusGuideView style={styles.grid}>
        {CARDS.map((card) => {
          const isFocused = focusedId === card.id;
          return (
            <Pressable
              key={card.id}
              testID={`card-${card.id}`}
              accessibilityRole="button"
              accessibilityLabel={`${card.label}, pressed ${
                counts[card.id] ?? 0
              } times`}
              hasTVPreferredFocus={card.id === 'a'}
              onFocus={() => setFocusedId(card.id)}
              onPress={() => press(card.id)}
              style={[
                styles.card,
                {backgroundColor: card.color},
                isFocused && styles.cardFocused,
              ]}>
              <Text style={styles.cardLabel}>{card.label}</Text>
              <Text style={styles.cardCount}>{counts[card.id] ?? 0}</Text>
            </Pressable>
          );
        })}
      </TVFocusGuideView>

      <Pressable
        testID="reset"
        accessibilityRole="button"
        accessibilityLabel="Reset all counters"
        onFocus={() => setFocusedId('reset')}
        onPress={reset}
        style={[styles.reset, focusedId === 'reset' && styles.resetFocused]}>
        <Text style={styles.resetLabel}>Reset counters</Text>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0B0F1A',
    paddingHorizontal: 64,
    paddingVertical: 40,
  },
  header: {
    marginBottom: 16,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 56,
    fontWeight: '700',
  },
  subtitle: {
    color: '#B8C0D4',
    fontSize: 24,
    marginTop: 4,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  status: {
    color: '#FFD54F',
    fontSize: 24,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 24,
  },
  card: {
    width: 260,
    height: 150,
    borderRadius: 20,
    padding: 16,
    justifyContent: 'space-between',
    opacity: 0.85,
  },
  cardFocused: {
    opacity: 1,
    borderWidth: 6,
    borderColor: '#FFFFFF',
    transform: [{scale: 1.08}],
  },
  cardLabel: {
    color: '#FFFFFF',
    fontSize: 30,
    fontWeight: '600',
  },
  cardCount: {
    color: '#FFFFFF',
    fontSize: 48,
    fontWeight: '700',
    textAlign: 'right',
  },
  reset: {
    alignSelf: 'flex-start',
    marginTop: 32,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: '#37474F',
  },
  resetFocused: {
    backgroundColor: '#FF6200',
    transform: [{scale: 1.08}],
  },
  resetLabel: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '600',
  },
});
