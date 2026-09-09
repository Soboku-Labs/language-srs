import React, { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import {
  addDays,
  findExamTrack,
  getExamTracksForLanguage,
  getLanguageProfile,
  suggestDailyNewLimit,
  toDateOnly,
} from '@language-srs/core';
import { useRouter } from 'expo-router';
import { useAuth } from '../src/auth/AuthProvider';
import { useEngine } from '../src/engine/EngineProvider';
import { widgetBridge } from '../modules/widget-bridge';
import { Caption, DetailRow, Row, Screen, Section, TextButton } from '../src/components/ui';
import { spacing, typography, useTheme, useThemedStyles, weight, type ResolvedTheme } from '../src/theme';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Settings.
 *
 * Grouped into four questions — which exam, which level, when, how much per day —
 * with explanation only where a choice is genuinely non-obvious. The earlier
 * version explained every field, which made a settings screen read like a manual
 * and buried the two controls people actually change.
 */
export default function SettingsScreen() {
  const { engine, revision, mutate } = useEngine();
  const { account, signOut } = useAuth();
  const router = useRouter();
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const code = engine.activeLanguage;

  const profile = useMemo(() => {
    return engine.getProfile(code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, revision, code]);

  const language = getLanguageProfile(code);
  const tracks = getExamTracksForLanguage(code);
  const track = findExamTrack(profile.examTrackId);

  const [examDateDraft, setExamDateDraft] = useState(profile.examDate ?? '');
  const [dateError, setDateError] = useState<string | undefined>();

  const applyExamDate = async (value: string) => {
    const trimmed = value.trim();

    if (trimmed === '') {
      setDateError(undefined);
      await mutate((instance) => instance.updateProfile(code, { examDate: undefined }));
      return;
    }

    if (!DATE_PATTERN.test(trimmed) || Number.isNaN(Date.parse(`${trimmed}T00:00:00.000Z`))) {
      setDateError('Use YYYY-MM-DD, for example 2026-12-06.');
      return;
    }

    setDateError(undefined);
    await mutate((instance) => instance.updateProfile(code, { examDate: trimmed }));
  };

  /** Words the deck actually holds for the selected level. */
  const available = useMemo(() => {
    return engine.getAvailableWordCount(code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, revision, code, profile.targetLevelId]);

  const suggestedNewLimit =
    profile.examDate && DATE_PATTERN.test(profile.examDate)
      ? suggestDailyNewLimit(profile.targetLevelId, engine.now(), profile.examDate, available)
      : undefined;

  return (
    <Screen>
      <Caption>Settings apply to {language.name}. Each language keeps its own.</Caption>

      {tracks.length > 1 ? (
        <Section title="Exam">
          <Row style={styles.wrap}>
            {tracks.map((candidate) => (
              <Choice
                key={candidate.id}
                label={candidate.name}
                selected={candidate.id === profile.examTrackId}
                onPress={() => void mutate((instance) => instance.setExamTrack(code, candidate.id))}
              />
            ))}
          </Row>
          {track?.note ? <Caption>{track.note}</Caption> : null}
        </Section>
      ) : null}

      <Section title="Level">
        <Row style={styles.wrap}>
          {(track?.levels ?? []).map((level) => (
            <Choice
              key={level.id}
              label={level.shortName}
              selected={level.id === profile.targetLevelId}
              onPress={() => void mutate((instance) => instance.updateProfile(code, { targetLevelId: level.id }))}
            />
          ))}
        </Row>
        {(() => {
          const level = track?.levels.find((candidate) => candidate.id === profile.targetLevelId);
          if (!level) return null;
          const shortfall = Math.max(0, level.vocabularyTarget - available);
          return (
            <>
              <Caption>{level.description}</Caption>
              {/*
                Two rows, because they are two different facts and running them
                together was the screen's worst lie. "Target vocabulary: 500
                words" is what the exam asks for; it is not what is in here, and
                read as one number it promised 500 words to study when the deck
                holds a few dozen.
              */}
              <DetailRow
                label="The exam covers"
                value={`${level.vocabularyTarget.toLocaleString()} words${
                  level.characterTarget ? ` · ${level.characterTarget.toLocaleString()} characters` : ''
                }`}
              />
              <DetailRow
                label="In your deck"
                value={`${available.toLocaleString()} word${available === 1 ? '' : 's'}`}
              />
              {shortfall > 0 ? (
                <Caption>
                  {available === 0
                    ? 'No words for this level yet. Import a word list to start it.'
                    : `${shortfall.toLocaleString()} of the exam's words are not in your deck yet. Import a word list to close the gap.`}
                </Caption>
              ) : null}
              {track && !track.targetsAreOfficial ? (
                <Caption>{track.authority} publishes no word list, so this is an estimate.</Caption>
              ) : null}
            </>
          );
        })()}
      </Section>

      <Section title="Exam date">
        <Row style={styles.wrap}>
          <TextInput
            value={examDateDraft}
            onChangeText={setExamDateDraft}
            onBlur={() => void applyExamDate(examDateDraft)}
            onSubmitEditing={() => void applyExamDate(examDateDraft)}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={theme.colors.inkFaint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="numbers-and-punctuation"
            style={styles.input}
          />
          {[30, 90, 180].map((days) => (
            <Choice
              key={days}
              label={`${days}d`}
              selected={false}
              onPress={() => {
                const value = toDateOnly(addDays(engine.now(), days));
                setExamDateDraft(value);
                void applyExamDate(value);
              }}
            />
          ))}
          {profile.examDate ? (
            <Choice
              label="clear"
              selected={false}
              onPress={() => {
                setExamDateDraft('');
                void applyExamDate('');
              }}
            />
          ) : null}
        </Row>
        {dateError ? <Text style={styles.error}>{dateError}</Text> : null}
        <Caption>
          {suggestedNewLimit
            ? `Covering this level by then takes about ${suggestedNewLimit} new words a day.`
            : 'With a date set, intervals tighten as the exam approaches so nothing lands after the paper.'}
        </Caption>
      </Section>

      <Section title="Each day">
        <Stepper
          label="New cards"
          value={profile.dailyNewLimit}
          step={5}
          min={0}
          max={200}
          onChange={(value) => void mutate((instance) => instance.updateProfile(code, { dailyNewLimit: value }))}
        />
        <Stepper
          label="Reviews"
          value={profile.dailyReviewLimit}
          step={20}
          min={20}
          max={999}
          onChange={(value) => void mutate((instance) => instance.updateProfile(code, { dailyReviewLimit: value }))}
        />
        <Stepper
          label="Target retention"
          value={Math.round(profile.desiredRetention * 100)}
          step={1}
          min={70}
          max={97}
          suffix="%"
          onChange={(value) =>
            void mutate((instance) => instance.updateProfile(code, { desiredRetention: value / 100 }))
          }
        />
        <Caption>
          Higher retention means shorter intervals and more reviews. 90% is where most learners get the best return.
        </Caption>
      </Section>

      <Section title="Account">
        <DetailRow label="Signed in as" value={account?.displayName ?? 'Not signed in'} />
        {account?.email ? <DetailRow label="Email" value={account.email} /> : null}
        {account?.provider === 'device' ? (
          <Caption>
            A local profile on this device. Progress is not carried to your other devices.
          </Caption>
        ) : null}
        <TextButton
          label={account?.provider === 'device' ? 'Sign in to an account' : 'Sign out'}
          {...(account?.provider === 'device'
            ? { onPress: () => router.push('/sign-in') }
            : {
                color: theme.colors.inkMuted,
                // Signing out leaves this account's cards where they are, under
                // its own storage prefix. Signing back in finds them.
                onPress: () => void signOut(),
              })}
        />
      </Section>

      <Section title="More">
        <DetailRow label="Accent" value={theme.accentName} />
        {widgetBridge.isSupported ? (
          <TextButton
            label="Refresh home-screen widget"
            onPress={() => void widgetBridge.publishSnapshot(engine.getWidgetSnapshot())}
          />
        ) : (
          <Caption>Home-screen widgets are an iOS and Android feature.</Caption>
        )}
        <TextButton
          label="Reset all progress"
          color={theme.colors.critical}
          onPress={() => void mutate((instance) => instance.reset())}
        />
      </Section>
    </Screen>
  );
}

function Choice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const styles = useThemedStyles(createStyles);
  return (
    <Pressable onPress={onPress} style={[styles.choice, selected && styles.choiceSelected]}>
      <Text style={[styles.choiceLabel, selected && styles.choiceLabelSelected]}>{label}</Text>
    </Pressable>
  );
}

function Stepper({
  label,
  value,
  step,
  min,
  max,
  suffix = '',
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  min: number;
  max: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  const styles = useThemedStyles(createStyles);
  const clamp = (next: number) => Math.min(max, Math.max(min, next));

  return (
    <View style={styles.stepper}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <View style={styles.stepperControls}>
        <Pressable onPress={() => onChange(clamp(value - step))} style={styles.stepperButton} accessibilityLabel={`Decrease ${label}`}>
          <Text style={styles.stepperGlyph}>−</Text>
        </Pressable>
        <Text style={styles.stepperValue}>
          {value}
          {suffix}
        </Text>
        <Pressable onPress={() => onChange(clamp(value + step))} style={styles.stepperButton} accessibilityLabel={`Increase ${label}`}>
          <Text style={styles.stepperGlyph}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

const createStyles = (theme: ResolvedTheme) => ({
  wrap: { flexWrap: 'wrap' as const, gap: spacing.sm },
  choice: {
    borderRadius: theme.radius.control,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  choiceSelected: { backgroundColor: theme.colors.accent },
  choiceLabel: { color: theme.colors.inkMuted, fontSize: typography.caption, fontWeight: weight.medium },
  choiceLabelSelected: { color: theme.colors.onAccent },
  input: {
    borderRadius: theme.radius.control,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    color: theme.colors.ink,
    fontSize: typography.caption,
    minWidth: 140,
  },
  error: { color: theme.colors.critical, fontSize: typography.caption },
  stepper: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingVertical: spacing.xs,
  },
  stepperLabel: { color: theme.colors.ink, fontSize: typography.body, flex: 1 },
  stepperControls: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md },
  stepperButton: {
    width: 36,
    height: 36,
    borderRadius: theme.radius.control,
    backgroundColor: theme.colors.surface,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  stepperGlyph: { color: theme.colors.ink, fontSize: typography.heading },
  stepperValue: {
    color: theme.colors.ink,
    fontSize: typography.body,
    fontWeight: weight.strong,
    minWidth: 48,
    textAlign: 'center' as const,
  },
});
