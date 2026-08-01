import React, { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import {
  VOCABULARY_SOURCES,
  addDays,
  findExamTrack,
  getExamTracksForLanguage,
  getLanguageProfile,
  getLevelSizes,
  suggestDailyNewLimit,
  toDateOnly,
} from '@language-srs/core';
import { useAuth } from '../src/auth/AuthProvider';
import { useSync } from '../src/auth/SyncProvider';
import { useEngine } from '../src/engine/EngineProvider';
import { widgetBridge } from '../modules/widget-bridge';
import { Caption, DetailRow, Row, Screen, Section, TextButton } from '../src/components/ui';
import { spacing, typography, useTheme, useThemedStyles, type ResolvedTheme } from '../src/theme';

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
  const { status } = useAuth();
  const { state: syncState } = useSync();
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const code = engine.activeLanguage;

  const profile = useMemo(() => {
    return engine.getProfile(code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, revision, code]);

  const language = getLanguageProfile(code);
  const levelSizes = getLevelSizes(code);
  const source = VOCABULARY_SOURCES[code];
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

  const suggestedNewLimit =
    profile.examDate && DATE_PATTERN.test(profile.examDate)
      ? suggestDailyNewLimit(profile.targetLevelId, engine.now(), profile.examDate)
      : undefined;

  return (
    <Screen>
      <Caption>Settings apply to {language.name}. Each language keeps its own.</Caption>

      {/* Persistence made visible. Every control here writes to storage as it is
          touched — there is no save button and never was — but a screen that
          gives no sign of having kept anything invites people to wonder, and to
          set the same thing twice. */}
      <Caption>{describeStorage(status === 'signed-in', syncState)}</Caption>

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
          return (
            <>
              <Caption>{level.description}</Caption>
              <DetailRow
                label="Target vocabulary"
                value={`${level.vocabularyTarget.toLocaleString()} words${
                  level.characterTarget ? ` · ${level.characterTarget.toLocaleString()} characters` : ''
                }`}
              />
              {/* What the app actually ships for this level, which is not the
                  same number as the syllabus target and should not pretend to
                  be. Cards are made from these words. */}
              <DetailRow label="Words in the app" value={`${(levelSizes[level.id] ?? 0).toLocaleString()}`} />
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
            placeholderTextColor={theme.colors.textFaint}
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

      <Section title="More">
        {/* The four themes share one ground and differ only in their ink, so this
            names the accent rather than a whole visual identity. */}
        <DetailRow label="Accent" value={theme.name} />
        <DetailRow label="Word list" value={source.name} />
        <Caption>
          {source.official
            ? `${source.licence}. Published by the examining body, so the levels here are exact.`
            : `${source.licence}. No official list is published for this exam, so levels are derived and coverage is an estimate.`}
        </Caption>
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
          color={theme.colors.danger}
          onPress={() => void mutate((instance) => instance.reset())}
        />
      </Section>
    </Screen>
  );
}

/** Where the settings on this screen have been written. */
function describeStorage(signedIn: boolean, syncState: string): string {
  if (!signedIn) return 'Saved on this device as you change them.';
  switch (syncState) {
    case 'syncing':
      return 'Saved on this device · syncing to your account…';
    case 'synced':
      return 'Saved on this device and in your account.';
    case 'offline':
      return 'Saved on this device · your account will catch up when you are back online.';
    default:
      return 'Saved on this device as you change them.';
  }
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
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  choiceSelected: { backgroundColor: theme.colors.accent },
  choiceLabel: { color: theme.colors.textMuted, fontSize: typography.caption, fontWeight: '600' as const },
  choiceLabelSelected: { color: theme.mode === 'light' ? '#FFFFFF' : theme.colors.background },
  input: {
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    color: theme.colors.text,
    fontSize: typography.caption,
    minWidth: 140,
  },
  error: { color: theme.colors.danger, fontSize: typography.caption },
  stepper: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingVertical: spacing.xs,
  },
  stepperLabel: { color: theme.colors.text, fontSize: typography.body, flex: 1 },
  stepperControls: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md },
  stepperButton: {
    width: 36,
    height: 36,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surface,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  stepperGlyph: { color: theme.colors.text, fontSize: typography.heading },
  stepperValue: {
    color: theme.colors.text,
    fontSize: typography.body,
    fontWeight: '700' as const,
    minWidth: 48,
    textAlign: 'center' as const,
  },
});
