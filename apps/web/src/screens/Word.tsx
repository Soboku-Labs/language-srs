import { useEffect, useMemo, useState } from 'react';
import {
  cardRetrievability,
  describeStruggle,
  findExamLevel,
  formatInterval,
  kindLabel,
  type Card,
} from '@language-srs/core';
import { useEngine } from '../providers';
import { useRouter } from '../router';
import { BigButton, Caption, Rise, Row, Screen, Section, TextButton, Title, ToneText } from '../ui';
import { useTheme } from '../theme';

/**
 * One word, in full.
 *
 * Where a number on the dashboard becomes checkable. The per-card rows are the
 * part worth having: a word is not one memory, and this is the first place the
 * app says so.
 */
export function Word({ id }: { id: string }) {
  const { engine, revision, mutate } = useEngine();
  const { palette } = useTheme();
  const { navigate, back } = useRouter();

  const row = useMemo(
    () => engine.getDeck().find((candidate) => candidate.entry.id === id),
    [engine, revision, id],
  );
  const allStruggling = useMemo(() => engine.getStrugglingCards(), [engine, revision]);

  if (!row) {
    return (
      <Screen>
        <Title>Not found</Title>
        <Caption>This word is not in your deck.</Caption>
        <BigButton label="Back" onClick={back} />
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
        <div className="word-hero">
          <ToneText
            text={entry.target}
            {...(entry.tones ? { tones: entry.tones } : {})}
            languageCode={entry.languageCode}
            size={entry.target.length > 6 ? 28 : 46}
          />
          <button
            type="button"
            className="word-hero__reading"
            onClick={() => speakWord(entry.target, entry.languageCode)}
            aria-label="Play pronunciation"
          >
            {entry.reading} <span style={{ color: palette.accent }}>♪</span>
          </button>
          <span className="word-hero__meaning">{entry.meanings.join(', ')}</span>
          <Caption>
            {[level?.shortName, entry.partOfSpeech, row.inScope ? undefined : 'outside your level']
              .filter(Boolean)
              .join(' · ')}
          </Caption>
        </div>
      </Rise>

      {entry.examples.length > 0 ? (
        <Rise index={1}>
          <Section title="In use">
            {entry.examples.map((example, index) => (
              <div key={index} className="example">
                <span className="example__target">{example.target}</span>
                {example.reading ? <Caption>{example.reading}</Caption> : null}
                <Caption>{example.translation}</Caption>
              </div>
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
            {struggling.map((candidate) => (
              <div key={candidate.card.id} className="detail">
                <span className="detail__label">{kindLabel(candidate.card.kind)}</span>
                <span className="detail__value" style={{ color: 'var(--ink-muted)', fontWeight: 400 }}>
                  {describeStruggle(candidate)}
                </span>
              </div>
            ))}
            {/*
              Two different repairs. Starting over throws away a schedule that
              has learned the word is hard and therefore keeps bringing it back
              forever; clearing the flag keeps the schedule and says the learner
              has handled it — usually by writing the note above.
            */}
            <Row wrap>
              <TextButton
                label="Start these over"
                onClick={() =>
                  void mutate(async (instance) => {
                    for (const candidate of struggling) await instance.resetCard(candidate.card.id);
                  })
                }
              />
              <TextButton
                label="I've handled it"
                muted
                onClick={() =>
                  void mutate(async (instance) => {
                    for (const candidate of struggling) await instance.clearLeech(candidate.card.id);
                  })
                }
              />
            </Row>
          </Section>
        </Rise>
      ) : null}

      <Rise index={5}>
        <Row>
          {dueCard ? (
            <TextButton
              label="Study this word"
              onClick={() => navigate(`/review?card=${encodeURIComponent(dueCard.id)}`)}
            />
          ) : null}
          <span className="spacer" />
          <TextButton
            label={suspended ? 'Put back in rotation' : 'Pause this word'}
            muted
            onClick={() => void mutate((instance) => instance.setEntrySuspended(entry.id, !suspended))}
          />
        </Row>
      </Rise>
    </Screen>
  );
}

function speakWord(text: string, languageCode: string): void {
  if (typeof speechSynthesis === 'undefined') return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = { zh: 'zh-CN', ja: 'ja-JP', ko: 'ko-KR', vi: 'vi-VN' }[languageCode] ?? languageCode;
  utterance.rate = 0.85;
  speechSynthesis.speak(utterance);
}

/**
 * A note the learner writes themselves.
 *
 * Saved explicitly rather than per keystroke: each save rewrites the entry and
 * notifies every screen watching the engine, and doing that per character would
 * rebuild the deck under the cursor.
 */
function NoteEditor({ value, onSave }: { value: string; onSave: (note: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const dirty = draft.trim() !== value.trim();

  return (
    <>
      <textarea
        className="field"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="A memory hook, a correction, anything that makes it stick"
        rows={3}
        aria-label="Your note on this word"
      />
      {dirty ? (
        <Row wrap>
          <TextButton label="Save note" onClick={() => onSave(draft)} />
          <TextButton label="Cancel" muted onClick={() => setDraft(value)} />
        </Row>
      ) : null}
    </>
  );
}

/**
 * One card of a word.
 *
 * Shows recall rather than stability. Stability is the number the scheduler
 * reasons about and means nothing to a person; "62%" is a probability they can
 * act on, and it is the same fact.
 */
function CardRow({ card, now }: { card: Card; now: string }) {
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
    <div className="card-row">
      <span className="card-row__kind">{kindLabel(card.kind)}</span>
      {/* An unstarted card gets no meter: an empty track is "no data" drawn as
          if it were zero, and on a fresh word that is every row. */}
      <span className={`card-row__meter${recall === undefined ? '' : ' track'}`}>
        {recall === undefined ? null : (
          <span
            className="track__fill"
            style={{
              width: `${Math.max(2, Math.round(recall * 100))}%`,
              ...(card.suspended ? { background: 'var(--ink-faint)' } : {}),
            }}
          />
        )}
      </span>
      <span className={`card-row__when${untilDue <= 0 && !card.suspended ? ' card-row__when--due' : ''}`}>
        {when}
      </span>
    </div>
  );
}
