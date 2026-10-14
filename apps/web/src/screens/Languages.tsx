import { LANGUAGE_CODES, getLanguageProfile, resolvePalette } from '@mon/core';
import { useEngine } from '../providers';
import { useRouter } from '../router';
import { Caption, Rise, Screen } from '../ui';
import { useTheme } from '../theme';

/**
 * The language picker.
 *
 * Each row carries its own accent as a dot, so the choice previews the change it
 * makes — picking Korean is also picking celadon. The endonym sits beside the
 * English name because that is what the learner is here for.
 */
export function Languages() {
  const { engine, revision, setActiveLanguage } = useEngine();
  const { mode } = useTheme();
  const { navigate } = useRouter();
  const active = engine.activeLanguage;
  void revision;

  return (
    <Screen>
      <Rise index={0}>
        <Caption>Each language keeps its own deck, exam track and settings.</Caption>
      </Rise>

      <ul className="deck">
        {LANGUAGE_CODES.map((code, index) => {
          const profile = getLanguageProfile(code);
          const palette = resolvePalette(code, mode);
          return (
            <li key={code}>
              <Rise index={index + 1}>
                <button
                  type="button"
                  className="language"
                  aria-current={code === active ? 'true' : undefined}
                  onClick={() => {
                    void setActiveLanguage(code).then(() => navigate('/', { replace: true }));
                  }}
                >
                  <span className="language__dot" style={{ background: palette.accent }} />
                  <span className="language__text">
                    <span className="language__name">
                      {profile.name}
                      <span className="language__endonym"> · {profile.endonym}</span>
                    </span>
                    <span className="language__tagline">{profile.tagline}</span>
                  </span>
                  {code === active ? <span className="language__check">✓</span> : null}
                </button>
              </Rise>
            </li>
          );
        })}
      </ul>
    </Screen>
  );
}
