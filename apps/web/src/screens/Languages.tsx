import {
  LANGUAGE_CODES,
  getCulture,
  getLanguageProfile,
  getLanguageTheme,
} from '@language-srs/core';
import { LanguageArt } from '../components/LanguageArt';
import { TeacherCard } from '../components/Teacher';
import { useEngine } from '../providers';
import { useRouter } from '../router';
import { Caption, Rise, Screen } from '../ui';

/**
 * The language picker.
 *
 * The one screen where the theme is the subject rather than the surface.
 * Choosing Korean is choosing celadon, a hanok roofline, and Sŏn sŏnsaengnim's
 * insistence that Hangul is read aloud before it is read — and every one of
 * those already exists in the core, stated once and shared with the phone.
 *
 * Deliberately heavier than the rest of the app. This is visited rarely and by
 * somebody making a decision, which is exactly the moment a picture earns its
 * place; the dashboard stays quiet because it is opened every morning.
 *
 * Each card draws in its own language's ink rather than the active theme's, so
 * four of them read as four places instead of one place in four shades.
 */
export function Languages() {
  const { engine, revision, setActiveLanguage } = useEngine();
  const { navigate } = useRouter();
  const active = engine.activeLanguage;
  void revision;

  return (
    <Screen>
      <Rise index={0}>
        <Caption>Each language keeps its own deck, exam track and settings.</Caption>
      </Rise>

      <div className="places">
        {LANGUAGE_CODES.map((code, index) => {
          const profile = getLanguageProfile(code);
          const theme = getLanguageTheme(code);
          const culture = getCulture(code);
          const chosen = code === active;

          return (
            <Rise index={index + 1} key={code}>
              <button
                type="button"
                className={`place${chosen ? ' place--chosen' : ''}`}
                aria-current={chosen ? 'true' : undefined}
                // The card borrows the language's accent for its own chrome,
                // scoped here rather than on `:root` so four of them can be on
                // screen at once without fighting.
                style={{
                  ['--place-accent' as string]: theme.colors.accent,
                  ['--place-wash' as string]: theme.colors.accentSoft,
                }}
                onClick={() => {
                  void setActiveLanguage(code).then(() => navigate('/', { replace: true }));
                }}
              >
                <LanguageArt code={code} className="place__art" animate={false} />

                <span className="place__head">
                  <span className="place__name">
                    {profile.name}
                    <span className="place__endonym"> · {profile.endonym}</span>
                  </span>
                  {chosen ? <span className="place__check">✓</span> : null}
                </span>

                <span className="place__where">
                  {culture.cityLocal} · {culture.countryLocal}
                </span>
                <span className="place__line">{culture.line}</span>

                <TeacherCard code={code} />

                {/*
                  The palette, named and explained. "Cinnabar — the red of a seal,
                  stamped once on a page of black ink" is the sentence that makes
                  the colour a decision rather than a default.
                */}
                <span className="place__palette">
                  <span className="place__swatch" aria-hidden="true" />
                  <span>
                    <b>{theme.name}</b> — {theme.inspiration}
                  </span>
                </span>
              </button>
            </Rise>
          );
        })}
      </div>
    </Screen>
  );
}
