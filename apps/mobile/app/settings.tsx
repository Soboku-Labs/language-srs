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
import { useEngine } from '../src/engine/EngineProvider';
import { widgetBridge } from '../modules/widget-bridge';
import { Body, Button, Caption, Chip, Divider, Heading, Panel, Row, Screen } from '../src/components/ui';
import { spacing, typography, useTheme, useThemedStyles, type ResolvedTheme } from '../src/theme';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export default function SettingsScreen() {
  const { engine, revision, mutate } = useEngine();
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

  const suggestedNewLimit =
    profile.examDate && DATE_PATTERN.test(profile.examDate)
      ? suggestDailyNewLimit(profile.targetLevelId, engine.now(), profile.examDate)
      : undefined;

  return (
    <Screen>
      <Caption>
        These settings apply to {language.name}. Every language keeps its own.
      </Caption>

      <Panel>
        <Heading>Exam track</Heading>
        <Caption>{track?.fullName}</Caption>
        {track?.note ? <Caption>{track.note}</Caption> : null}

        <Row style={styles.wrap}>
          {tracks.map((candidate) => (
            <Selectable
              key={candidate.id}
              label={candidate.name}
              selected={candidate.id === profile.examTrackId}
              onPress={() => void mutate((instance) => instance.setExamTrack(code, candidate.id))}
            />
          ))}
        </Row>

        {track && !track.targetsAreOfficial ? (
          <Caption>
            {track.authority} does not publish a vocabulary list for this exam, so coverage targets here are estimates.
          </Caption>
        ) : null}
      </Panel>

      <Panel>
        <Heading>Target level</Heading>
        <Caption>Study scope is this level and everything below it, matching how these syllabuses accumulate.</Caption>

        <View style={styles.levelList}>
          {(track?.levels ?? []).map((level) => {
            const selected = level.id === profile.targetLevelId;
            return (
              <Pressable
                key={level.id}
                onPress={() => void mutate((instance) => instance.updateProfile(code, { targetLevelId: level.id }))}
                style={[styles.levelRow, selected && styles.levelRowSelected]}
              >
                <View style={styles.levelText}>
                  <Row style={styles.levelHeader}>
                    <Text style={styles.levelName}>{level.name}</Text>
                    {level.cefr ? <Chip label={level.cefr} color={theme.colors.textMuted} /> : null}
                  </Row>
                  <Caption>{level.description}</Caption>
                  <Caption>
                    {level.vocabularyTarget.toLocaleString()} words
                    {level.characterTarget ? ` · ${level.characterTarget.toLocaleString()} characters` : ''}
                    {level.passingScore && level.totalScore
                      ? ` · pass ${level.passingScore}/${level.totalScore}`
                      : ''}
                  </Caption>
                </View>
                {selected ? <Text style={styles.tick}>✓</Text> : null}
              </Pressable>
            );
          })}
        </View>
      </Panel>

      <Panel>
        <Heading>Exam date</Heading>
        <Caption>
          With a date set, the scheduler raises its retention target and caps intervals as the exam approaches, so nothing
          is scheduled to land after the paper.
        </Caption>

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
        {dateError ? <Text style={styles.error}>{dateError}</Text> : null}

        <Row style={styles.wrap}>
          {[30, 60, 90, 180].map((days) => (
            <Selectable
              key={days}
              label={`in ${days}d`}
              selected={false}
              onPress={() => {
                const value = toDateOnly(addDays(engine.now(), days));
                setExamDateDraft(value);
                void applyExamDate(value);
              }}
            />
          ))}
          <Selectable
            label="clear"
            selected={false}
            onPress={() => {
              setExamDateDraft('');
              void applyExamDate('');
            }}
          />
        </Row>

        {suggestedNewLimit ? (
          <Caption>
            To cover this level&apos;s new vocabulary by then you would need about {suggestedNewLimit} new words a day.
          </Caption>
        ) : null}
      </Panel>

      <Panel>
        <Heading>Daily limits</Heading>
        <Stepper
          label="New cards per day"
          value={profile.dailyNewLimit}
          step={5}
          min={0}
          max={200}
          onChange={(value) => void mutate((instance) => instance.updateProfile(code, { dailyNewLimit: value }))}
        />
        <Divider />
        <Stepper
          label="Reviews per day"
          value={profile.dailyReviewLimit}
          step={20}
          min={20}
          max={999}
          onChange={(value) => void mutate((instance) => instance.updateProfile(code, { dailyReviewLimit: value }))}
        />
        <Divider />
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
          Higher retention means shorter intervals and more reviews for the same material. 90% is the point where most
          learners get the best return; above 95% the extra reviews buy very little.
        </Caption>
      </Panel>

      <Panel>
        <Heading>Home-screen widget</Heading>
        {widgetBridge.isSupported ? (
          <Caption>
            The widget updates every time you finish a card. Grade from the home screen and the app applies it through
            the same scheduler next time you open it.
          </Caption>
        ) : (
          <Caption>
            Home-screen widgets are an iOS and Android feature, so there is nothing to configure in the browser. The same
            data drives the dashboard here.
          </Caption>
        )}
        <Button
          label="Refresh widget now"
          tone="ghost"
          onPress={() => void widgetBridge.publishSnapshot(engine.getWidgetSnapshot())}
          disabled={!widgetBridge.isSupported}
        />
      </Panel>

      <Panel>
        <Heading>Theme</Heading>
        <Caption>
          {language.name} uses the {theme.name.toLowerCase()} theme — {theme.inspiration} It follows the language rather
          than being chosen separately, so switching language on the Languages screen re-themes the app and its widget
          together.
        </Caption>
      </Panel>

      <Panel>
        <Heading>Reset</Heading>
        <Body muted>Deletes all cards, review history and settings for every language.</Body>
        <Button label="Reset all progress" tone="ghost" onPress={() => void mutate((instance) => instance.reset())} />
      </Panel>
    </Screen>
  );
}

function Selectable({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const styles = useThemedStyles(createStyles);
  return (
    <Pressable onPress={onPress} style={[styles.selectable, selected && styles.selectableSelected]}>
      <Text style={[styles.selectableLabel, selected && styles.selectableLabelSelected]}>{label}</Text>
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
    <Row style={styles.stepper}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <Row style={styles.stepperControls}>
        <Pressable onPress={() => onChange(clamp(value - step))} style={styles.stepperButton}>
          <Text style={styles.stepperGlyph}>−</Text>
        </Pressable>
        <Text style={styles.stepperValue}>
          {value}
          {suffix}
        </Text>
        <Pressable onPress={() => onChange(clamp(value + step))} style={styles.stepperButton}>
          <Text style={styles.stepperGlyph}>+</Text>
        </Pressable>
      </Row>
    </Row>
  );
}

const createStyles = (theme: ResolvedTheme) => ({
  wrap: { flexWrap: 'wrap' as const, gap: spacing.sm },
  selectable: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm - 2,
  },
  selectableSelected: { borderColor: theme.colors.accent, backgroundColor: theme.colors.accentSoft },
  selectableLabel: {
    color: theme.colors.textMuted,
    fontSize: typography.caption,
    fontWeight: '600' as const,
  },
  selectableLabelSelected: { color: theme.colors.text },
  levelList: { gap: spacing.sm },
  levelRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.control,
    padding: spacing.md,
  },
  levelRowSelected: { borderColor: theme.colors.accent, backgroundColor: theme.colors.surfaceRaised },
  levelText: { flex: 1, gap: 2 },
  levelHeader: { gap: spacing.sm },
  levelName: { color: theme.colors.text, fontSize: typography.body, fontWeight: '600' as const },
  tick: { color: theme.colors.accent, fontSize: typography.heading },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.control,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: theme.colors.text,
    fontSize: typography.body,
  },
  error: { color: theme.colors.danger, fontSize: typography.caption },
  stepper: { justifyContent: 'space-between' as const, paddingVertical: spacing.sm },
  stepperLabel: { color: theme.colors.text, fontSize: typography.body, flex: 1 },
  stepperControls: { gap: spacing.md },
  stepperButton: {
    width: 34,
    height: 34,
    borderRadius: theme.radius.control,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  stepperGlyph: { color: theme.colors.text, fontSize: typography.heading },
  stepperValue: {
    color: theme.colors.text,
    fontSize: typography.body,
    fontWeight: '600' as const,
    minWidth: 52,
    textAlign: 'center' as const,
  },
});
