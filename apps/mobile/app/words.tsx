import React, { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import {
  byWeakestFirst,
  countBands,
  findExamLevel,
  getTrackForLevel,
  levelProgress,
  summariseWord,
  summariseWords,
  type Card,
  type ExamLevel,
  type WordBand,
} from '@language-srs/core';
import { useEngine } from '../src/engine/EngineProvider';
import { useVocabulary } from '../src/vocabulary/VocabularyProvider';
import { useLevelWords } from '../src/vocabulary/useLevelWords';
import { Caption, Row, Screen, Section, TextButton } from '../src/components/ui';
import { BAND_LABELS, BandBar, StrengthLegend, WordChip } from '../src/components/WordGrid';
import { Skeleton, Spinner } from '../src/components/Skeleton';
import { Press, Rise } from '../src/motion/components';
import { spacing, typography, useTheme, useThemedStyles, type ResolvedTheme } from '../src/theme';

/**
 * The vocabulary.
 *
 * Two questions, and they want two different pictures. "How am I doing on the
 * level I am working on" is a question about individual words, so it gets the
 * grid — every word in the level, tinted from just-met to known. "How far
 * through the syllabus am I" is a question about levels, so it gets one row per
 * level and no words at all.
 *
 * Splitting them is what keeps either from being useless. A single view that
 * showed every word of every level would be fourteen thousand chips and no
 * answer to either question; and it would mean downloading nine levels to draw
 * nine bars, which is the bundle mistake this app just spent a release undoing.
 * The all-levels view is computed from cards and the manifest alone — no level
 * is fetched until you open it.
 */

/** Words drawn before the "show the rest" link. A level can hold five hundred. */
const PAGE = 180;

type Mode = 'level' | 'all';
type Sort = 'syllabus' | 'weakest';

export default function WordsScreen() {
  const { engine, revision } = useEngine();
  const params = useLocalSearchParams<{ level?: string }>();

  const profile = engine.getProfile();
  const [mode, setMode] = useState<Mode>('level');
  const [levelId, setLevelId] = useState<string>(params.level ?? profile.targetLevelId);

  const styles = useThemedStyles(createStyles);

  const cards = useMemo(
    () => engine.getAllCards(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, revision],
  );

  return (
    <Screen>
      <Rise index={0}>
        <Row style={styles.tabs}>
          <Tab label="This level" active={mode === 'level'} onPress={() => setMode('level')} />
          <Tab label="All levels" active={mode === 'all'} onPress={() => setMode('all')} />
        </Row>
      </Rise>

      {mode === 'level' ? (
        <LevelView levelId={levelId} cards={cards} now={engine.now()} />
      ) : (
        <AllLevelsView
          cards={cards}
          now={engine.now()}
          activeLevelId={profile.targetLevelId}
          onOpen={(id) => {
            setLevelId(id);
            setMode('level');
          }}
        />
      )}
    </Screen>
  );
}

/* ------------------------------------------------------------------ level */

function LevelView({ levelId, cards, now }: { levelId: string; cards: Card[]; now: string }) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const { entries, loading, unavailable } = useLevelWords(levelId);

  const [sort, setSort] = useState<Sort>('syllabus');
  const [filter, setFilter] = useState<WordBand | undefined>();
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState<string | undefined>();

  const level = findExamLevel(levelId);

  const words = useMemo(() => summariseWords(entries, cards, now), [entries, cards, now]);
  const counts = useMemo(() => countBands(words), [words]);
  const held = levelProgress(words);

  const shown = useMemo(() => {
    const filtered = filter ? words.filter((word) => word.band === filter) : words;
    return sort === 'weakest' ? [...filtered].sort(byWeakestFirst) : filtered;
  }, [words, filter, sort]);

  const byId = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries]);

  if (loading) return <LevelSkeleton />;

  if (unavailable || entries.length === 0) {
    return (
      <Rise index={1} style={styles.empty}>
        <Caption>
          {level?.name ?? levelId} has no word list on this device yet. It arrives the next time the
          app can reach the server.
        </Caption>
      </Rise>
    );
  }

  return (
    <>
      <Rise index={1} style={styles.headline}>
        <Text style={styles.levelName}>{level?.name ?? levelId}</Text>
        <Row style={styles.headlineRow}>
          <Text style={styles.big}>{counts.mature + counts.young}</Text>
          <Text style={styles.bigUnit}>of {words.length} held</Text>
        </Row>
        {/* Green rather than the language's accent. Cinnabar is Mandarin's
            accent and also, on this screen, the colour of a word that is
            slipping — one red meaning two things is worse than a bar that does
            not match the chrome. Green is the same green the known chips are. */}
        <View style={styles.track}>
          <View
            style={[styles.trackFill, { width: `${Math.round(held * 100)}%`, backgroundColor: theme.colors.good }]}
          />
        </View>
        <StrengthLegend counts={{ unseen: counts.unseen, struggling: counts.struggling }} />
      </Rise>

      {/* The filters are the counts. Two rows — a number and a chip that does
          something — would say the same thing twice, and the second one would
          be the one people press. */}
      <Rise index={2}>
        <Row style={styles.filters}>
          {(['mature', 'young', 'learning', 'struggling', 'unseen'] as WordBand[])
            .filter((band) => counts[band] > 0)
            .map((band) => (
              <BandFilter
                key={band}
                band={band}
                count={counts[band]}
                active={filter === band}
                onPress={() => setFilter(filter === band ? undefined : band)}
              />
            ))}
        </Row>
      </Rise>

      <Rise index={3}>
        <Section
          title={filter ? BAND_LABELS[filter] : 'Every word'}
          action={
            <TextButton
              label={sort === 'weakest' ? 'syllabus order' : 'weakest first'}
              onPress={() => setSort(sort === 'weakest' ? 'syllabus' : 'weakest')}
            />
          }
        >
          <View style={styles.grid}>
            {shown.slice(0, limit).map((word) => {
              const entry = byId.get(word.entryId);
              if (!entry) return null;
              return (
                <WordChip
                  key={word.entryId}
                  entry={entry}
                  word={word}
                  expanded={selected === word.entryId}
                  onPress={() => setSelected(selected === word.entryId ? undefined : word.entryId)}
                />
              );
            })}
          </View>

          {shown.length > limit ? (
            <TextButton
              label={`Show ${Math.min(PAGE, shown.length - limit)} more`}
              onPress={() => setLimit(limit + PAGE)}
              color={theme.colors.textMuted}
            />
          ) : null}
        </Section>
      </Rise>
    </>
  );
}

/* ------------------------------------------------------------- all levels */

/**
 * The syllabus, one row per level.
 *
 * Built from cards and the manifest, never from the words: a card knows which
 * level it belongs to, and the manifest knows how many words each level has, so
 * a nine-level track costs nine numbers rather than five thousand entries. The
 * levels a learner has never opened correctly show as untouched, because they
 * are.
 */
function AllLevelsView({
  cards,
  now,
  activeLevelId,
  onOpen,
}: {
  cards: Card[];
  now: string;
  activeLevelId: string;
  onOpen: (levelId: string) => void;
}) {
  const styles = useThemedStyles(createStyles);
  const { manifest, loading } = useVocabulary();
  const { engine } = useEngine();

  const track = getTrackForLevel(activeLevelId);
  const sizes = manifest?.languages[engine.activeLanguage]?.levels;

  const rows = useMemo(() => {
    if (!track) return [];

    const byLevel = new Map<string, Card[]>();
    for (const card of cards) {
      const bucket = byLevel.get(card.levelId);
      if (bucket) bucket.push(card);
      else byLevel.set(card.levelId, [card]);
    }

    return track.levels.map((level) => {
      const levelCards = byLevel.get(level.id) ?? [];
      const entryIds = [...new Set(levelCards.map((card) => card.entryId))];
      const studied = entryIds.map((entryId) => summariseWord(entryId, levelCards, now));

      // The words with no cards are still part of the level. The manifest is
      // the only thing that knows how many, and without it the bar would show
      // a level as complete because the only three words in it are the three
      // that have been studied.
      const total = sizes?.[level.id] ?? Math.max(studied.length, 0);
      const counts = countBands(studied);
      counts.unseen += Math.max(0, total - studied.length);

      return { level, counts, total, held: counts.mature + counts.young };
    });
  }, [track, cards, now, sizes]);

  if (!track) {
    return (
      <Rise index={1} style={styles.empty}>
        <Caption>No exam track is set for this language yet.</Caption>
      </Rise>
    );
  }

  const known = rows.reduce((total, row) => total + row.held, 0);
  const words = rows.reduce((total, row) => total + row.total, 0);

  return (
    <>
      <Rise index={1} style={styles.headline}>
        <Text style={styles.levelName}>{track.fullName}</Text>
        <Row style={styles.headlineRow}>
          {sizes ? (
            <>
              <Text style={styles.big}>{known}</Text>
              <Text style={styles.bigUnit}>of {words.toLocaleString()} words held</Text>
            </>
          ) : (
            <Row style={styles.waiting}>
              <Spinner size={14} />
              <Caption>{loading.size > 0 ? 'Fetching the syllabus…' : 'Level sizes unavailable offline'}</Caption>
            </Row>
          )}
        </Row>
        {!track.targetsAreOfficial ? (
          <Caption>
            {track.name} does not publish an official word list; these totals are the widely-cited
            estimates, so read the bars as a shape rather than a score.
          </Caption>
        ) : null}
      </Rise>

      <Rise index={2}>
        <Section title="Levels">
          {rows.map((row) => (
            <LevelRow
              key={row.level.id}
              level={row.level}
              counts={row.counts}
              total={row.total}
              held={row.held}
              current={row.level.id === activeLevelId}
              onPress={() => onOpen(row.level.id)}
            />
          ))}
          <Caption>
            Open a level to see its words. Levels beyond the one you are studying are downloaded when
            you look at them, not before.
          </Caption>
        </Section>
      </Rise>
    </>
  );
}

function LevelRow({
  level,
  counts,
  total,
  held,
  current,
  onPress,
}: {
  level: ExamLevel;
  counts: Record<WordBand, number>;
  total: number;
  held: number;
  current: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);

  return (
    <Press onPress={onPress} accessibilityRole="button" style={styles.levelRow}>
      <View style={styles.levelRowHead}>
        <Text style={[styles.levelRowName, current ? { color: theme.colors.accent } : null]}>
          {level.shortName}
          {level.cefr ? <Text style={styles.levelRowCefr}>{`  ${level.cefr}`}</Text> : null}
        </Text>
        <Text style={styles.levelRowCount}>
          {total > 0 ? `${held} / ${total}` : '—'}
        </Text>
      </View>
      <BandBar counts={counts} total={total} />
    </Press>
  );
}

/* ------------------------------------------------------------------ parts */

function Tab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);

  return (
    <Press
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      style={[styles.tab, active ? { backgroundColor: theme.colors.accentSoft } : null]}
    >
      <Text style={[styles.tabLabel, active ? { color: theme.colors.accent } : null]}>{label}</Text>
    </Press>
  );
}

function BandFilter({
  band,
  count,
  active,
  onPress,
}: {
  band: WordBand;
  count: number;
  active: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);

  const color = {
    mature: theme.colors.good,
    young: theme.colors.good,
    learning: theme.colors.hard,
    struggling: theme.colors.again,
    unseen: theme.colors.textFaint,
  }[band];

  return (
    <Press
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[styles.filter, active ? { backgroundColor: `${color}1F` } : null]}
    >
      <Text style={[styles.filterCount, { color }]}>{count}</Text>
      <Text style={styles.filterLabel}>{BAND_LABELS[band]}</Text>
    </Press>
  );
}

/** The grid's shape before its words land — same geometry, so nothing jumps. */
function LevelSkeleton() {
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.skeleton}>
      <Skeleton width="45%" height={20} />
      <Skeleton width="60%" height={34} />
      <Skeleton width="100%" height={6} radius={999} />
      <View style={styles.grid}>
        {Array.from({ length: 36 }, (_, index) => (
          <Skeleton key={index} width={54 + ((index * 13) % 40)} height={36} />
        ))}
      </View>
    </View>
  );
}

const createStyles = (theme: ResolvedTheme) => ({
  tabs: { gap: spacing.sm },
  tab: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: theme.radius.pill,
  },
  tabLabel: { color: theme.colors.textMuted, fontSize: typography.caption, fontWeight: '600' as const },

  headline: { gap: spacing.sm },
  headlineRow: { alignItems: 'baseline' as const, gap: spacing.sm },
  levelName: { color: theme.colors.textMuted, fontSize: typography.caption },
  big: {
    color: theme.colors.text,
    fontSize: 40,
    lineHeight: 44,
    fontWeight: '600' as const,
    letterSpacing: -1,
  },
  bigUnit: { color: theme.colors.textMuted, fontSize: typography.body },
  waiting: { gap: spacing.sm },

  track: {
    height: 5,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surfaceRaised,
    overflow: 'hidden' as const,
  },
  trackFill: { height: '100%' as const, borderRadius: theme.radius.pill, backgroundColor: theme.colors.accent },

  filters: { flexWrap: 'wrap' as const, gap: spacing.xs },
  filter: {
    flexDirection: 'row' as const,
    alignItems: 'baseline' as const,
    gap: 5,
    paddingVertical: 5,
    paddingHorizontal: spacing.md,
    borderRadius: theme.radius.pill,
  },
  filterCount: { fontSize: typography.body, fontWeight: '700' as const },
  filterLabel: { color: theme.colors.textMuted, fontSize: typography.micro },

  grid: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm },
  empty: { paddingVertical: spacing.xl },
  skeleton: { gap: spacing.lg },

  levelRow: { gap: spacing.sm, paddingVertical: spacing.sm },
  levelRowHead: {
    flexDirection: 'row' as const,
    alignItems: 'baseline' as const,
    justifyContent: 'space-between' as const,
  },
  levelRowName: { color: theme.colors.text, fontSize: typography.body, fontWeight: '600' as const },
  levelRowCefr: { color: theme.colors.textFaint, fontSize: typography.micro, fontWeight: '400' as const },
  levelRowCount: { color: theme.colors.textMuted, fontSize: typography.caption },
});
