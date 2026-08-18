import React from 'react';
import { Text, View } from 'react-native';
import type { LanguageCode } from '@language-srs/core';
import { useTheme, useThemedStyles, weight, type ResolvedTheme } from '../theme';

/**
 * Target-language text with each syllable coloured by its tone.
 *
 * Splitting into syllables is language-specific, and getting it wrong makes the
 * colouring actively misleading:
 *
 *  - Mandarin writes one syllable per character, so the split is per character.
 *  - Vietnamese writes syllables as whitespace-separated units, so `điện thoại`
 *    is two syllables and splitting per character would produce ten.
 *
 * When the tone count and the syllable count disagree — which happens with
 * imported data of varying quality — the text is rendered plainly rather than
 * colouring syllables against the wrong tones. Colour is the answer on a tone
 * card, so a wrong colour is worse than no colour.
 *
 * The ramp comes from the active language and mode. It is one of only two places
 * colour survived the move to the Suboku system, because here the colour *is* the
 * answer rather than a restatement of a label.
 */
export function ToneText({
  text,
  tones,
  languageCode,
  size = 44,
}: {
  text: string;
  tones?: number[];
  languageCode: LanguageCode;
  size?: number;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);

  const syllables = splitSyllables(text, languageCode);
  const canColour = tones !== undefined && tones.length === syllables.length && syllables.length > 0;

  if (!canColour) {
    return <Text style={[styles.plain, { fontSize: size }]}>{text}</Text>;
  }

  return (
    <View style={styles.row}>
      {syllables.map((syllable, index) => (
        <Text
          key={`${syllable}-${index}`}
          style={[styles.plain, { fontSize: size, color: theme.toneColor(tones[index] as number) }]}
        >
          {syllable}
          {languageCode === 'vi' && index < syllables.length - 1 ? ' ' : ''}
        </Text>
      ))}
    </View>
  );
}

export function splitSyllables(text: string, languageCode: LanguageCode): string[] {
  if (languageCode === 'vi') {
    return text.split(/\s+/).filter((part) => part.length > 0);
  }
  if (languageCode === 'zh') {
    // Per character, skipping punctuation so 你好， does not count as three.
    return [...text].filter((char) => /\p{Script=Han}/u.test(char));
  }
  return [text];
}

const createStyles = (theme: ResolvedTheme) => ({
  row: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    justifyContent: 'center' as const,
    alignItems: 'baseline' as const,
  },
  plain: { color: theme.colors.ink, fontWeight: weight.medium, textAlign: 'center' as const },
});
