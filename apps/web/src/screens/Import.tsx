import { useState } from 'react';
import {
  CSV_COLUMNS,
  LANGUAGE_CODES,
  exportVocabularyJson,
  getExamTracksForLanguage,
  getLanguageProfile,
  parseVocabularyCsv,
  parseVocabularyJson,
  type ImportIssue,
  type ImportResult,
  type LanguageCode,
} from '@language-srs/core';
import { useEngine } from '../providers';
import { useRouter } from '../router';
import { BigButton, Caption, Choice, Rise, Row, Screen, Section, TextButton } from '../ui';

/**
 * Getting vocabulary in and out.
 *
 * The parsers and the exporter live in core; this is the way to reach them. On
 * the web both a paste box and a real file input are available — the file input
 * is an ordinary `<input type="file">` here rather than the imperatively-built
 * element the React Native build needed.
 */
export function Import() {
  const { engine, revision, mutate } = useEngine();
  const { navigate } = useRouter();

  const active = engine.activeLanguage;
  const profile = engine.getProfile(active);
  void revision;

  const [text, setText] = useState('');
  const [format, setFormat] = useState<'csv' | 'json'>('csv');
  const [language, setLanguage] = useState<LanguageCode>(active);
  const [levelId, setLevelId] = useState(profile.targetLevelId);
  const [done, setDone] = useState<{ added: number; replaced: number } | undefined>();
  const [exported, setExported] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const tracks = getExamTracksForLanguage(language);

  /**
   * Parsed on every keystroke rather than behind a "check" button.
   *
   * A word list is usually wrong in some small way the first time, and finding
   * that out while you can still see what you pasted beats being told after you
   * commit.
   */
  const trimmed = text.trim();
  const result: ImportResult | undefined =
    trimmed.length === 0
      ? undefined
      : format === 'json'
        ? parseVocabularyJson(trimmed)
        : parseVocabularyCsv(trimmed, { languageCode: language, defaultLevelId: levelId });

  const errors = result?.issues.filter((issue) => issue.severity === 'error') ?? [];
  const warnings = result?.issues.filter((issue) => issue.severity === 'warning') ?? [];

  const onImport = async () => {
    if (!result || result.entries.length === 0) return;
    setBusy(true);
    try {
      setDone(await mutate((instance) => instance.importEntries(result.entries)));
      setText('');
    } finally {
      setBusy(false);
    }
  };

  const onExport = () => {
    const json = exportVocabularyJson(engine.getEntries(active));
    setExported(json);
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${active}-vocabulary.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (done) {
    return (
      <Screen>
        <Rise index={0}>
          <div className="hero">
            <span className="hero__count">{done.added + done.replaced}</span>
            <Caption>
              {done.added} new word{done.added === 1 ? '' : 's'}
              {done.replaced > 0 ? `, ${done.replaced} updated` : ''}. Cards are ready now.
            </Caption>
          </div>
        </Rise>
        <Rise index={1}>
          <BigButton label="Start studying" onClick={() => navigate('/review')} />
        </Rise>
        <Rise index={2}>
          <Row center>
            <TextButton label="Import more" onClick={() => setDone(undefined)} />
            <TextButton label="Back home" muted onClick={() => navigate('/home')} />
          </Row>
        </Rise>
      </Screen>
    );
  }

  return (
    <Screen>
      <Rise index={0}>
        <Section title="Format">
          <Row wrap>
            <Choice label="CSV word list" selected={format === 'csv'} onClick={() => setFormat('csv')} />
            <Choice label="JSON export" selected={format === 'json'} onClick={() => setFormat('json')} />
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
        those are chosen here. JSON exports carry both per entry.
      */}
      {format === 'csv' ? (
        <Rise index={1}>
          <Section title="These words are">
            <Row wrap>
              {LANGUAGE_CODES.map((code) => (
                <Choice
                  key={code}
                  label={getLanguageProfile(code).name}
                  selected={language === code}
                  onClick={() => {
                    setLanguage(code);
                    const first = getExamTracksForLanguage(code)[0]?.levels[0];
                    if (first) setLevelId(first.id);
                  }}
                />
              ))}
            </Row>
            {/*
              Grouped by track and labelled, because Mandarin has two of them and
              flattening the levels produced two chips both reading "HSK 1".
            */}
            {tracks.map((track) => (
              <div key={track.id} className="stack--tight stack">
                {tracks.length > 1 ? <span className="micro">{track.name}</span> : null}
                <Row wrap>
                  {track.levels.map((level) => (
                    <Choice
                      key={level.id}
                      label={level.shortName}
                      selected={levelId === level.id}
                      onClick={() => setLevelId(level.id)}
                    />
                  ))}
                </Row>
              </div>
            ))}
            <Caption>Used for rows that do not name their own level.</Caption>
          </Section>
        </Rise>
      ) : null}

      <Rise index={2}>
        <Section title="Paste the list">
          <textarea
            className="field field--mono field--tall"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setDone(undefined);
            }}
            placeholder={format === 'csv' ? '你好,nǐ hǎo,hello;hi,hsk3-1' : '[{ "target": "你好", ... }]'}
            spellCheck={false}
            aria-label="Paste your word list"
          />
          <label className="link" style={{ display: 'inline-block' }}>
            Choose a file instead
            <input
              type="file"
              accept=".csv,.json,.txt,text/csv,application/json,text/plain"
              style={{ display: 'none' }}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                void file.text().then((contents) => {
                  setText(contents);
                  setFormat(file.name.toLowerCase().endsWith('.json') ? 'json' : 'csv');
                  setDone(undefined);
                });
              }}
            />
          </label>
        </Section>
      </Rise>

      {result ? (
        <Rise index={3}>
          <Section title="Preview">
            <Row>
              <Count value={result.accepted} label="ready" color="var(--good)" />
              {result.rejected > 0 ? (
                <Count value={result.rejected} label="skipped" color="var(--again)" />
              ) : null}
              {warnings.length > 0 ? (
                <Count value={warnings.length} label="warnings" color="var(--hard)" />
              ) : null}
            </Row>

            {result.entries.length > 0 ? (
              <div className="sample">
                {result.entries.slice(0, 3).map((entry) => (
                  <span key={entry.id} className="sample__row">
                    <strong>{entry.target}</strong>
                    {entry.reading ? `  ${entry.reading}` : ''}
                    {`  ·  ${entry.meanings.join(', ')}`}
                  </span>
                ))}
                {result.entries.length > 3 ? (
                  <Caption>and {result.entries.length - 3} more</Caption>
                ) : null}
              </div>
            ) : null}

            {/*
              Issues carry their row numbers. "6 rows skipped" is not something
              anyone can fix; "row 41: unknown exam level hsk3-9" is.
            */}
            {errors.length + warnings.length > 0 ? (
              <div className="stack--tight stack">
                {[...errors, ...warnings].slice(0, 8).map((issue, index) => (
                  <IssueRow key={`${issue.row}-${index}`} issue={issue} />
                ))}
                {errors.length + warnings.length > 8 ? (
                  <Caption>and {errors.length + warnings.length - 8} more</Caption>
                ) : null}
              </div>
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
              onClick={() => void onImport()}
            />
          </Section>
        </Rise>
      ) : null}

      <Rise index={4}>
        <Section title="Back up">
          <Caption>
            Everything you have for {getLanguageProfile(active).name}, including your own notes, as JSON
            you can import again.
          </Caption>
          <TextButton label={`Export ${engine.getEntries(active).length} words`} onClick={onExport} />
          {exported ? (
            <textarea className="field field--mono" value={exported} readOnly rows={6} aria-label="Exported JSON" />
          ) : null}
        </Section>
      </Rise>
    </Screen>
  );
}

function Count({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <span className="stat">
      <span className="stat__value" style={{ color }}>
        {value}
      </span>
      <span className="stat__label">{label}</span>
    </span>
  );
}

function IssueRow({ issue }: { issue: ImportIssue }) {
  return (
    <div className="issue">
      <span
        className="issue__row"
        style={{ color: issue.severity === 'error' ? 'var(--again)' : 'var(--hard)' }}
      >
        {issue.row > 0 ? `Row ${issue.row}` : 'File'}
      </span>
      <span className="issue__text">{issue.message}</span>
    </div>
  );
}
