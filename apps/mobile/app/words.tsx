import React, { useMemo, useState } from 'react';
import { FlatList, Platform, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  countByStatus,
  filterDeck,
  sortDeck,
  type DeckEntry,
  type DeckSort,
  type DeckStatus,
} from '@mon/core';
import { useEngine } from '../src/engine/EngineProvider';
import { Caption, Row, Screen } from '../src/components/ui';
import { Press } from '../src/motion/components';
import { spacing, typography, useTheme, useThemedStyles, weight, type ResolvedTheme } from '../src/theme';

/**
 * The deck.
 *
 * The app could tell you how many words you knew but never which ones, which made
 * every number on the dashboard unauditable — a learner who thinks they have
 * forgotten 桌子 had no way to check, and no way to do anything about it. This is
 * that list: search it, filter it, tap a word to see its cards.
 *
 * One row is one word, not one card. Nobody wants to know that a word's listening
 * card is due Thursday; they want to know whether they know the word.
 */

const STATUS_LABELS: Record<DeckStatus, string> = {
  new: 'Unseen',
  learning: 'Learning',
  review: 'Known',
  suspended: 'Paused',
};

const SORT_LABELS: Record<DeckSort, string> = {
  level: 'Level',
  weakest: 'Weakest',
  due: 'Next due',
  alphabetical: 'A–Z',
};

export default function WordsScreen() {
  const { engine, revision } = useEngine();
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const router = useRouter();

  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<DeckStatus | undefined>();
  const [sort, setSort] = useState<DeckSort>('level');

  const deck = useMemo(() => {
    return engine.getDeck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, revision]);

  const counts = useMemo(() => countByStatus(deck), [deck]);

  const rows = useMemo(() => {
    return sortDeck(
      filterDeck(deck, { ...(query ? { query } : {}), ...(status ? { status } : {}) }),
      sort,
    );
  }, [deck, query, status, sort]);

  return (
    <Screen scroll={false}>
      {/*
        An explicit stack. The non-scrolling Screen is a bare View with no gap of
        its own, so without this the search field, the chips and the list sit
        flush against each other.
      */}
      <View style={styles.controls}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search words, readings, meanings"
          placeholderTextColor={theme.colors.inkFaint}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.search}
          // Clearing is a one-tap job on a list you are scanning; hunting for the
          // backspace key on a phone to undo a mistyped search is not.
          clearButtonMode="while-editing"
        />

        <Row style={styles.filters}>
          <Chip
            label={`All ${deck.length}`}
            active={status === undefined}
            onPress={() => setStatus(undefined)}
          />
          {(['learning', 'review', 'new', 'suspended'] as DeckStatus[])
            .filter((candidate) => counts[candidate] > 0)
            .map((candidate) => (
              <Chip
                key={candidate}
                label={`${STATUS_LABELS[candidate]} ${counts[candidate]}`}
                active={status === candidate}
                onPress={() => setStatus(status === candidate ? undefined : candidate)}
              />
            ))}
        </Row>

        <Row style={styles.sorts}>
          {(Object.keys(SORT_LABELS) as DeckSort[]).map((candidate) => (
            <Press key={candidate} onPress={() => setSort(candidate)} accessibilityRole="button">
              <Text style={[styles.sortLabel, sort === candidate && styles.sortLabelActive]}>
                {SORT_LABELS[candidate]}
              </Text>
            </Press>
          ))}
        </Row>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(row) => row.entry.id}
        style={styles.list}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Caption>{query ? `Nothing matches “${query}”.` : 'No words here yet.'}</Caption>
          </View>
        }
        renderItem={({ item }) => (
          <WordRow row={item} onPress={() => router.push(`/word/${encodeURIComponent(item.entry.id)}`)} />
        )}
      />
    </Screen>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const styles = useThemedStyles(createStyles);
  return (
    <Press onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: active }}>
      <View style={[styles.chip, active && styles.chipActive]}>
        <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{label}</Text>
      </View>
    </Press>
  );
}

/**
 * One word.
 *
 * The strength bar is the weakest of the word's cards rather than their mean,
 * because a word whose meaning is solid and whose tones are gone is not
 * half-known — it is a word you will get wrong.
 *
 * A word with nothing studied gets no bar at all. An empty track on every row of
 * a fresh deck is thirty grey dashes saying "no data" thirty times.
 */
function WordRow({ row, onPress }: { row: DeckEntry; onPress: () => void }) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);

  return (
    <Press onPress={onPress} accessibilityRole="button" style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.rowTarget} numberOfLines={1}>
          {row.entry.target}
        </Text>
        <Text style={styles.rowMeaning} numberOfLines={1}>
          {row.entry.reading} · {row.entry.meanings.join(', ')}
        </Text>
      </View>

      <View style={styles.rowRight}>
        {row.dueNow > 0 ? <Text style={styles.rowDue}>{row.dueNow} due</Text> : null}
        {row.weakest !== undefined ? (
          <View style={styles.strengthTrack}>
            <View
              style={[
                styles.strengthFill,
                {
                  width: `${Math.max(2, Math.round(row.weakest * 100))}%`,
                  backgroundColor:
                    row.status === 'suspended' ? theme.colors.inkFaint : theme.colors.accent,
                },
              ]}
            />
          </View>
        ) : null}
      </View>
    </Press>
  );
}

const createStyles = (theme: ResolvedTheme) => ({
  controls: { gap: spacing.md, paddingBottom: spacing.md },
  search: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.control,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: theme.colors.ink,
    fontSize: typography.body,
  },
  filters: { flexWrap: 'wrap' as const, gap: spacing.sm },
  sorts: { flexWrap: 'wrap' as const, gap: spacing.lg },

  chip: {
    borderRadius: theme.radius.control,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm - 2,
  },
  chipActive: { backgroundColor: theme.colors.ink },
  chipLabel: { color: theme.colors.inkMuted, fontSize: typography.caption, fontWeight: weight.medium },
  chipLabelActive: { color: theme.colors.canvas },

  sortLabel: { color: theme.colors.inkFaint, fontSize: typography.caption, fontWeight: weight.medium },
  sortLabelActive: { color: theme.colors.ink },

  list: { flex: 1, marginHorizontal: -spacing.xs },
  separator: { height: 1, backgroundColor: theme.colors.surfaceRaised },
  empty: { paddingVertical: spacing.xxl, alignItems: 'center' as const },

  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
    ...Platform.select({ web: { cursor: 'pointer' as const }, default: {} }),
  },
  rowText: { flex: 1, gap: 2 },
  rowTarget: { color: theme.colors.ink, fontSize: typography.heading + 3, fontWeight: weight.medium },
  rowMeaning: { color: theme.colors.inkMuted, fontSize: typography.caption },

  rowRight: { alignItems: 'flex-end' as const, gap: spacing.xs, width: 76 },
  rowDue: { color: theme.colors.accent, fontSize: typography.micro, fontWeight: weight.medium },
  strengthTrack: {
    height: 3,
    width: '100%' as const,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surfaceRaised,
    overflow: 'hidden' as const,
  },
  strengthFill: { height: '100%' as const, borderRadius: theme.radius.pill },
});
