import React, { useEffect, useMemo, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  cardRetrievability,
  describeStruggle,
  findExamLevel,
  formatInterval,
  kindLabel,
  type Card,
  type DeckEntry,
} from '@mon/core';
import { useEngine } from '../../src/engine/EngineProvider';
import { speakEntry } from '../../src/components/ReviewCard';
import { BigButton, Caption, Row, Screen, Section, TextButton, Title } from '../../src/components/ui';
import { ToneText } from '../../src/components/ToneText';
import { Press, Rise } from '../../src/motion/components';
import { spacing, typography, useTheme, useThemedStyles, weight, type ResolvedTheme } from '../../src/theme';

/**
 * One word, in full.
 *
 * This is where a number on the dashboard becomes checkable. "78% of the syllabus"
 * is an assertion; this screen is the evidence for one word of it — which of its
 * cards exist, how strong each is, and when each comes back.
 *
 * The per-card rows are the part worth having. A word is not one memory, and the
 * app has always known that internally; this is the first place it says so.
 */
export default function WordScreen() {
  const { engine, revision, mutate } = useEngine();
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const row: DeckEntry | undefined = useMemo(() => {
    return engine.getDeck().find((candidate) => candidate.entry.id === id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, revision, id]);

  const allStruggling = useMemo(() => {
    return engine.getStrugglingCards();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, revision]);

  if (!row) {
    return (
      <Screen>
        <Title>Not found</Title>
        <Caption>This word is not in your deck.</Caption>
        <BigButton label="Back" onPress={() => router.back()} />
      </Screen>
    );
  }

  const { entry, cards } = row;
  const level = findExamLevel(entry.levelIds[0] ?? '');
  const suspended = row.status === 'suspended';
  const dueCard = cards.find((card) => !card.suspended && row.dueNow > 0);
  const struggling = allStruggling.filter((candidate) => candidate.entry.id === entry.id);

  return (
    <Screen>
      <Rise index={0}>
        <View style={styles.hero}>
          <ToneText
            text={entry.target}
            tones={entry.tones}
            languageCode={entry.languageCode}
            size={entry.target.length > 6 ? typography.targetSmall : typography.target}
          />
          <Press
            onPress={() => speakEntry(entry.target, entry.languageCode)}
            accessibilityRole="button"
            accessibilityLabel="Play pronunciation"
          >
            <Text style={styles.reading}>
              {entry.reading} <Text style={{ color: theme.colors.accent }}>♪</Text>
            </Text>
          </Press>
          <Text style={styles.meaning}>{entry.meanings.join(', ')}</Text>
          <Caption>
            {[level?.shortName, entry.partOfSpeech, row.inScope ? undefined : 'outside your level']
              .filter(Boolean)
              .join(' · ')}
          </Caption>
        </View>
      </Rise>

      {entry.examples.length > 0 ? (
        <Rise index={1}>
          <Section title="In use">
            {entry.examples.map((example, index) => (
              <View key={index} style={styles.example}>
                <Text style={styles.exampleTarget}>{example.target}</Text>
                {example.reading ? <Caption>{example.reading}</Caption> : null}
                <Caption>{example.translation}</Caption>
              </View>
            ))}
          </Section>
        </Rise>
      ) : null}

      <Rise index={2}>
        <Section title={`${cards.length} card${cards.length === 1 ? '' : 's'}`}>
          {cards.length === 0 ? (
            <Caption>
              No cards yet — this word sits outside the levels you are studying, so nothing has been
              generated for it.
            </Caption>
          ) : (
            cards.map((card) => <CardRow key={card.id} card={card} now={engine.now()} />)
          )}
        </Section>
      </Rise>

      {/*
        The note is the learner's own, and it is the single most effective thing
        they can do about a word that keeps slipping — which is why the rescue
        actions below sit next to it rather than on a separate screen.
      */}
      <Rise index={3}>
        <Section title="Your note">
          <NoteEditor
            value={entry.mnemonic ?? ''}
            onSave={(note) => void mutate((instance) => instance.setEntryNote(entry.id, note))}
          />
        </Section>
      </Rise>

      {struggling.length > 0 ? (
        <Rise index={4}>
          <Section title="Not sticking">
            {struggling.map((row) => (
              <View key={row.card.id} style={styles.struggleRow}>
                <Text style={styles.struggleKind}>{kindLabel(row.card.kind)}</Text>
                <Text style={styles.struggleText}>{describeStruggle(row)}</Text>
              </View>
            ))}
            <Row style={styles.wrapRow}>
              {/*
                Two different repairs, and the difference matters. Starting over
                throws away a schedule that has learned the word is hard and
                therefore keeps bringing it back forever. Clearing the flag keeps
                the schedule and says the learner has handled it — usually by
                writing the note above.
              */}
              <TextButton
                label="Start these over"
                onPress={() =>
                  void mutate(async (instance) => {
                    for (const row of struggling) await instance.resetCard(row.card.id);
                  })
                }
              />
              <TextButton
                label="I've handled it"
                color={theme.colors.inkMuted}
                onPress={() =>
                  void mutate(async (instance) => {
                    for (const row of struggling) await instance.clearLeech(row.card.id);
                  })
                }
              />
            </Row>
          </Section>
        </Rise>
      ) : null}

      <Rise index={5}>
        <Row style={styles.actions}>
          {dueCard ? (
            <TextButton
              label="Study this word"
              onPress={() => router.push(`/review?card=${encodeURIComponent(dueCard.id)}`)}
            />
          ) : null}
          <View style={styles.spacer} />
          {/*
            Suspending is the only destructive-ish action here and it is fully
            reversible, so it needs no confirmation — a dialog guarding a toggle
            teaches people to dismiss dialogs.
          */}
          <TextButton
            label={suspended ? 'Put back in rotation' : 'Pause this word'}
            color={theme.colors.inkMuted}
            onPress={() => void mutate((instance) => instance.setEntrySuspended(entry.id, !suspended))}
          />
        </Row>
      </Rise>
    </Screen>
  );
}

/**
 * A note the learner writes themselves.
 *
 * Saved explicitly rather than on every keystroke. Each save rewrites the entry
 * and notifies every screen watching the engine, and doing that per character
 * would rebuild the deck under the cursor.
 *
 * The button appears only once the text differs from what is stored, so the
 * common case — opening a word to read it — shows no controls at all.
 */
function NoteEditor({ value, onSave }: { value: string; onSave: (note: string) => void }) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const [draft, setDraft] = useState(value);

  // A different word arrived under the same component, or the save landed.
  useEffect(() => setDraft(value), [value]);

  const dirty = draft.trim() !== value.trim();

  return (
    <>
      <TextInput
        value={draft}
        onChangeText={setDraft}
        placeholder="A memory hook, a correction, anything that makes it stick"
        placeholderTextColor={theme.colors.inkFaint}
        multiline
        style={styles.note}
      />
      {dirty ? (
        <Row style={styles.wrapRow}>
          <TextButton label="Save note" onPress={() => onSave(draft)} />
          <TextButton label="Cancel" color={theme.colors.inkMuted} onPress={() => setDraft(value)} />
        </Row>
      ) : null}
    </>
  );
}

/**
 * One card of a word.
 *
 * Shows recall rather than stability. Stability is the number the scheduler
 * reasons about and it means nothing to a person; "62%" is a probability they can
 * act on, and it is the same fact.
 */
function CardRow({ card, now }: { card: Card; now: string }) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);

  const recall = card.state === 'new' ? undefined : cardRetrievability(card, now);
  const untilDue = Date.parse(card.due) - Date.parse(now);

  const when = card.suspended
    ? 'paused'
    : card.state === 'new'
      ? 'not started'
      : untilDue <= 0
        ? 'due now'
        : `in ${formatInterval(untilDue / 86_400_000)}`;

  return (
    <View style={styles.cardRow}>
      <Text style={styles.cardKind}>{kindLabel(card.kind)}</Text>
      {/* An unstarted card gets no meter: an empty track is "no data" drawn as if
          it were zero, and on a fresh word that is every row. */}
      <View style={[styles.cardMeter, recall !== undefined && styles.cardMeterTrack]}>
        {recall === undefined ? null : (
          <View
            style={[
              styles.cardMeterFill,
              {
                width: `${Math.max(2, Math.round(recall * 100))}%`,
                backgroundColor: card.suspended ? theme.colors.inkFaint : theme.colors.accent,
              },
            ]}
          />
        )}
      </View>
      <Text style={[styles.cardWhen, untilDue <= 0 && !card.suspended && { color: theme.colors.ink }]}>
        {when}
      </Text>
    </View>
  );
}

const createStyles = (theme: ResolvedTheme) => ({
  hero: { alignItems: 'center' as const, gap: spacing.sm, paddingVertical: spacing.lg },
  reading: { color: theme.colors.inkMuted, fontSize: typography.heading },
  meaning: {
    color: theme.colors.ink,
    fontSize: typography.title,
    fontWeight: weight.medium,
    textAlign: 'center' as const,
  },

  example: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.control,
    padding: spacing.md,
    gap: 2,
  },
  exampleTarget: { color: theme.colors.ink, fontSize: typography.body + 1, lineHeight: 25 },

  cardRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  cardKind: { color: theme.colors.ink, fontSize: typography.caption, width: 84 },
  cardMeter: {
    flex: 1,
    height: 3,
    borderRadius: theme.radius.pill,
    overflow: 'hidden' as const,
  },
  cardMeterTrack: { backgroundColor: theme.colors.surfaceRaised },
  cardMeterFill: { height: '100%' as const, borderRadius: theme.radius.pill },
  cardWhen: {
    color: theme.colors.inkMuted,
    fontSize: typography.micro,
    width: 68,
    textAlign: 'right' as const,
  },

  actions: { gap: spacing.md },
  wrapRow: { flexWrap: 'wrap' as const, gap: spacing.lg },
  spacer: { flex: 1 },

  note: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.control,
    padding: spacing.md,
    color: theme.colors.ink,
    fontSize: typography.caption,
    lineHeight: 20,
    minHeight: 64,
    textAlignVertical: 'top' as const,
  },

  struggleRow: {
    flexDirection: 'row' as const,
    gap: spacing.md,
    alignItems: 'baseline' as const,
    paddingVertical: spacing.xs,
  },
  struggleKind: { color: theme.colors.ink, fontSize: typography.caption, width: 84 },
  struggleText: { color: theme.colors.inkMuted, fontSize: typography.caption, flex: 1, lineHeight: 18 },
});
