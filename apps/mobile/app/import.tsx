import React, { useMemo, useState } from 'react';
import { Platform, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  CSV_COLUMNS,
  exportVocabularyJson,
  getExamTracksForLanguage,
  getLanguageProfile,
  parseVocabularyCsv,
  parseVocabularyJson,
  type ImportIssue,
  type ImportResult,
  type LanguageCode,
} from '@language-srs/core';
import { useEngine } from '../src/engine/EngineProvider';
import { BigButton, Caption, Row, Screen, Section, TextButton } from '../src/components/ui';
import { Press, Rise } from '../src/motion/components';
import { spacing, typography, useTheme, useThemedStyles, weight, type ResolvedTheme } from '../src/theme';

/**
 * Getting vocabulary in and out.
 *
 * The parser and the exporter have been in core since the beginning with nothing
 * in the app able to reach them, which left the deck permanently at the few dozen
 * seed words per language — against syllabi of five hundred to eleven thousand.
 * Every honest "your deck is 473 words short" the app now prints was a dead end
 * until this screen existed.
 *
 * Paste is the primary input rather than a file picker, because it needs no
 * native module and therefore works the same on the web, on iOS and on Android.
 * On the web a file can be chosen as well, through a DOM input built on demand in
 * the handler — never rendered into the React Native tree, where it would not
 * exist on a phone.
 */

type Format = 'csv' | 'json';

export default function ImportScreen() {
  const { engine, revision, mutate } = useEngine();
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const router = useRouter();

  const active = engine.activeLanguage;
  const profile = useMemo(() => {
    return engine.getProfile(active);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, revision, active]);

  const [text, setText] = useState('');
  const [format, setFormat] = useState<Format>('csv');
  const [language, setLanguage] = useState<LanguageCode>(active);
  const [levelId, setLevelId] = useState(profile.targetLevelId);
  const [done, setDone] = useState<{ added: number; replaced: number } | undefined>();
  const [exported, setExported] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const tracks = useMemo(() => getExamTracksForLanguage(language), [language]);

  /**
   * Parsed on every keystroke rather than behind a "check" button.
   *
   * A word list is usually wrong in some small way the first time — a stray
   * header, the wrong level id — and finding that out while you can still see
   * what you pasted beats being told after you commit.
   */
  const result: ImportResult | undefined = useMemo(() => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return undefined;

    return format === 'json'
      ? parseVocabularyJson(trimmed)
      : parseVocabularyCsv(trimmed, { languageCode: language, defaultLevelId: levelId });
  }, [text, format, language, levelId]);

  const errors = result?.issues.filter((issue) => issue.severity === 'error') ?? [];
  const warnings = result?.issues.filter((issue) => issue.severity === 'warning') ?? [];

  const onPickFile = () => {
    pickTextFile((contents, name) => {
      setText(contents);
      setFormat(name.toLowerCase().endsWith('.json') ? 'json' : 'csv');
      setDone(undefined);
    });
  };

  const onImport = async () => {
    if (!result || result.entries.length === 0) return;
    setBusy(true);
    try {
      const outcome = await mutate((instance) => instance.importEntries(result.entries));
      setDone(outcome);
      setText('');
    } finally {
      setBusy(false);
    }
  };

  const onExport = () => {
    const json = exportVocabularyJson(engine.getEntries(active));
    setExported(json);
    downloadText(`${active}-vocabulary.json`, json);
  };

  if (done) {
    return (
      <Screen>
        <Rise index={0}>
          <View style={styles.doneBlock}>
            <Text style={styles.doneCount}>{done.added + done.replaced}</Text>
            <Caption>
              {done.added} new word{done.added === 1 ? '' : 's'}
              {done.replaced > 0 ? `, ${done.replaced} updated` : ''}. Cards are ready now.
            </Caption>
          </View>
        </Rise>
        <Rise index={1}>
          <BigButton label="Start studying" onPress={() => router.replace('/review')} />
        </Rise>
        <Rise index={2}>
          <Row style={styles.centeredRow}>
            <TextButton label="Import more" onPress={() => setDone(undefined)} />
            <TextButton label="Back home" color={theme.colors.inkMuted} onPress={() => router.replace('/')} />
          </Row>
        </Rise>
      </Screen>
    );
  }

  return (
    <Screen>
      <Rise index={0}>
        <Section title="Format">
          <Row style={styles.wrap}>
            <Choice label="CSV word list" selected={format === 'csv'} onPress={() => setFormat('csv')} />
            <Choice label="JSON export" selected={format === 'json'} onPress={() => setFormat('json')} />
          </Row>
          <Caption>
            {format === 'csv'
              ? `Columns, in order: ${CSV_COLUMNS.join(', ')}. Only target and meanings are required. Separate multiple meanings, tags or levels with a semicolon.`
              : 'An array of entries, or an object with an `entries` array — what the export below produces.'}
          </Caption>
        </Section>
      </Rise>

      {/*
        A CSV of a word list almost never carries its own language or level, so
        those are chosen here. JSON exports carry both per entry and these would
        be ignored, so they are not shown.
      */}
      {format === 'csv' ? (
        <Rise index={1}>
          <Section title="These words are">
            <Row style={styles.wrap}>
              {(['zh', 'ja', 'ko', 'vi'] as LanguageCode[]).map((code) => (
                <Choice
                  key={code}
                  label={getLanguageProfile(code).name}
                  selected={language === code}
                  onPress={() => {
                    setLanguage(code);
                    const first = getExamTracksForLanguage(code)[0]?.levels[0];
                    if (first) setLevelId(first.id);
                  }}
                />
              ))}
            </Row>
            {/*
              Grouped by track, and labelled, because Mandarin has two of them and
              flattening the levels produced two chips both reading "HSK 1" with
              nothing to tell them apart — the exact ambiguity that makes an import
              land on a level the learner did not mean.
            */}
            {tracks.map((track) => (
              <View key={track.id} style={styles.levelGroup}>
                {tracks.length > 1 ? <Text style={styles.trackLabel}>{track.name}</Text> : null}
                <Row style={styles.wrap}>
                  {track.levels.map((level) => (
                    <Choice
                      key={level.id}
                      label={level.shortName}
                      selected={levelId === level.id}
                      onPress={() => setLevelId(level.id)}
                    />
                  ))}
                </Row>
              </View>
            ))}
            <Caption>Used for rows that do not name their own level.</Caption>
          </Section>
        </Rise>
      ) : null}

      <Rise index={2}>
        <Section title="Paste the list">
          <TextInput
            value={text}
            onChangeText={(next) => {
              setText(next);
              setDone(undefined);
            }}
            placeholder={format === 'csv' ? '你好,nǐ hǎo,hello;hi,hsk3-1' : '[{ "target": "你好", ... }]'}
            placeholderTextColor={theme.colors.inkFaint}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            style={styles.paste}
          />
          {Platform.OS === 'web' ? <TextButton label="Choose a file instead" onPress={onPickFile} /> : null}
        </Section>
      </Rise>

      {result ? (
        <Rise index={3}>
          <Section title="Preview">
            <Row style={styles.counts}>
              <Count value={result.accepted} label="ready" color={theme.colors.good} />
              {result.rejected > 0 ? (
                <Count value={result.rejected} label="skipped" color={theme.colors.again} />
              ) : null}
              {warnings.length > 0 ? (
                <Count value={warnings.length} label="warnings" color={theme.colors.hard} />
              ) : null}
            </Row>

            {result.entries.length > 0 ? (
              <View style={styles.sample}>
                {result.entries.slice(0, 3).map((entry) => (
                  <Text key={entry.id} style={styles.sampleRow} numberOfLines={1}>
                    <Text style={styles.sampleTarget}>{entry.target}</Text>
                    {entry.reading ? `  ${entry.reading}` : ''}
                    {`  ·  ${entry.meanings.join(', ')}`}
                  </Text>
                ))}
                {result.entries.length > 3 ? (
                  <Caption>and {result.entries.length - 3} more</Caption>
                ) : null}
              </View>
            ) : null}

            {/*
              Issues are listed with their row numbers rather than summarised as a
              count. "6 rows skipped" is not something anyone can fix; "row 41:
              unknown exam level hsk3-9" is.
            */}
            {errors.length > 0 || warnings.length > 0 ? (
              <View style={styles.issues}>
                {[...errors, ...warnings].slice(0, 8).map((issue, index) => (
                  <IssueRow key={`${issue.row}-${index}`} issue={issue} />
                ))}
                {errors.length + warnings.length > 8 ? (
                  <Caption>and {errors.length + warnings.length - 8} more</Caption>
                ) : null}
              </View>
            ) : null}

            <BigButton
              label={
                result.accepted > 0
                  ? `Import ${result.accepted} word${result.accepted === 1 ? '' : 's'}`
                  : 'Nothing to import'
              }
              {...(result.rejected > 0 && result.accepted > 0
                ? { hint: `${result.rejected} row${result.rejected === 1 ? '' : 's'} will be skipped` }
                : {})}
              disabled={busy || result.accepted === 0}
              onPress={() => void onImport()}
            />
          </Section>
        </Rise>
      ) : null}

      <Rise index={4}>
        <Section title="Back up">
          <Caption>
            Everything you have for {getLanguageProfile(active).name}, including your own notes, as JSON you
            can import again.
          </Caption>
          <TextButton
            label={`Export ${engine.getEntries(active).length} words`}
            onPress={onExport}
          />
          {exported ? (
            <TextInput
              value={exported}
              multiline
              editable={false}
              // Selectable rather than editable: on a phone with no download this
              // is the only way to get the text out, and an editable box would
              // invite changes that go nowhere.
              style={[styles.paste, styles.exported]}
            />
          ) : null}
        </Section>
      </Rise>
    </Screen>
  );
}

function Choice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const styles = useThemedStyles(createStyles);
  return (
    <Press onPress={onPress} accessibilityRole="button" accessibilityState={{ selected }}>
      <View style={[styles.choice, selected && styles.choiceSelected]}>
        <Text style={[styles.choiceLabel, selected && styles.choiceLabelSelected]}>{label}</Text>
      </View>
    </Press>
  );
}

function Count({ value, label, color }: { value: number; label: string; color: string }) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.count}>
      <Text style={[styles.countValue, { color }]}>{value}</Text>
      <Text style={styles.countLabel}>{label}</Text>
    </View>
  );
}

function IssueRow({ issue }: { issue: ImportIssue }) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const tone = issue.severity === 'error' ? theme.colors.again : theme.colors.hard;

  return (
    <View style={styles.issue}>
      <Text style={[styles.issueRow, { color: tone }]}>{issue.row > 0 ? `Row ${issue.row}` : 'File'}</Text>
      <Text style={styles.issueText}>{issue.message}</Text>
    </View>
  );
}

/**
 * Read a text file on the web.
 *
 * The input is built in the handler and never rendered, so there is nothing for
 * React Native to choke on when this file is bundled for a phone — and the
 * caller is still guarded by a platform check, because on native there is no
 * `document` to build it from.
 */
function pickTextFile(onRead: (contents: string, name: string) => void): void {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.csv,.json,.txt,text/csv,application/json,text/plain';
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onRead(String(reader.result ?? ''), file.name);
    reader.readAsText(file);
  };
  input.click();
}

/** Save a file on the web. A no-op elsewhere, where the text box is the way out. */
function downloadText(filename: string, contents: string): void {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;

  const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

const createStyles = (theme: ResolvedTheme) => ({
  wrap: { flexWrap: 'wrap' as const, gap: spacing.sm },
  levelGroup: { gap: spacing.sm },
  trackLabel: { color: theme.colors.inkFaint, fontSize: typography.micro, fontWeight: weight.medium },
  centeredRow: { justifyContent: 'center' as const, gap: spacing.xl },

  choice: {
    borderRadius: theme.radius.control,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  choiceSelected: { backgroundColor: theme.colors.ink },
  choiceLabel: { color: theme.colors.inkMuted, fontSize: typography.caption, fontWeight: weight.medium },
  choiceLabelSelected: { color: theme.colors.canvas },

  paste: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.control,
    padding: spacing.md,
    color: theme.colors.ink,
    fontSize: typography.caption,
    minHeight: 150,
    textAlignVertical: 'top' as const,
    ...Platform.select({ web: { fontFamily: 'ui-monospace, Menlo, monospace' }, default: {} }),
  },
  exported: { minHeight: 120, color: theme.colors.inkMuted },

  counts: { gap: spacing.xl },
  count: { gap: 1 },
  countValue: { fontSize: 21, fontWeight: weight.medium },
  countLabel: { color: theme.colors.inkMuted, fontSize: typography.micro },

  sample: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.control,
    padding: spacing.md,
    gap: spacing.xs,
  },
  sampleRow: { color: theme.colors.inkMuted, fontSize: typography.caption },
  sampleTarget: { color: theme.colors.ink, fontSize: typography.body, fontWeight: weight.medium },

  issues: { gap: spacing.sm },
  issue: { flexDirection: 'row' as const, gap: spacing.sm, alignItems: 'baseline' as const },
  issueRow: { fontSize: typography.micro, fontWeight: weight.strong, width: 58 },
  issueText: { color: theme.colors.inkMuted, fontSize: typography.caption, flex: 1, lineHeight: 18 },

  doneBlock: { alignItems: 'center' as const, gap: spacing.sm, paddingVertical: spacing.xxl },
  doneCount: {
    color: theme.colors.ink,
    fontSize: typography.display,
    lineHeight: typography.display + 8,
    fontWeight: weight.regular,
    letterSpacing: -2,
  },
});
