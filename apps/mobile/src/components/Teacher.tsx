import React from 'react';
import { Text, View, type ViewStyle } from 'react-native';
import { getLanguageTheme, type Teacher } from '@language-srs/core';
import { spacing, typography, useTheme, useThemedStyles, type ResolvedTheme } from '../theme';

/**
 * The teacher, as something you can see.
 *
 * A portrait rather than an illustration: one character from the teacher's name,
 * set in their language's accent on a wash of it. Four hand-drawn faces would
 * date the app in a year and would have to be redrawn every time a language was
 * added; a monogram is the same idea a seal or a signature block already is in
 * all four of these writing traditions, and it costs nothing to render.
 */

const SIZES = {
  small: { box: 36, glyph: typography.body },
  medium: { box: 48, glyph: typography.title },
  large: { box: 64, glyph: typography.title + 6 },
} as const;

export function TeacherAvatar({
  teacher,
  size = 'medium',
  style,
}: {
  teacher: Teacher;
  size?: keyof typeof SIZES;
  style?: ViewStyle;
}) {
  // The teacher's own language colours the portrait, not the active theme, so a
  // row of four on the landing page reads as four people rather than one.
  const languageTheme = getLanguageTheme(teacher.languageCode);
  const { box, glyph } = SIZES[size];

  return (
    <View
      style={[
        {
          width: box,
          height: box,
          borderRadius: box / 2,
          backgroundColor: languageTheme.colors.accentSoft,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
      accessible
      accessibilityLabel={`${teacher.address}, teacher of ${teacher.romanised}`}
    >
      <Text
        style={{
          color: languageTheme.colors.accent,
          // "Mai" needs to be set smaller than 林 to occupy the same circle.
          fontSize: teacher.glyph.length > 1 ? glyph * 0.62 : glyph,
          fontWeight: '600',
        }}
      >
        {teacher.glyph}
      </Text>
    </View>
  );
}

/**
 * Something the teacher says.
 *
 * Quiet on purpose — one line, muted, no bubble. It is company during a routine,
 * not a notification, and anything louder would compete with the card.
 */
export function TeacherNote({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'center' }) {
  const styles = useThemedStyles(createStyles);
  return <Text style={[styles.note, align === 'center' && styles.centered]}>{children}</Text>;
}

/** Portrait, name and a line, for the dashboard header and the end of a session. */
export function TeacherSays({
  teacher,
  line,
  size = 'medium',
}: {
  teacher: Teacher;
  line: string;
  size?: keyof typeof SIZES;
}) {
  const styles = useThemedStyles(createStyles);
  const theme = useTheme();

  return (
    <View style={styles.says}>
      <TeacherAvatar teacher={teacher} size={size} />
      <View style={styles.saysText}>
        <Text style={[styles.name, { color: theme.colors.text }]}>{teacher.address}</Text>
        <TeacherNote>{line}</TeacherNote>
      </View>
    </View>
  );
}

const createStyles = (theme: ResolvedTheme) => ({
  note: { color: theme.colors.textMuted, fontSize: typography.caption, lineHeight: 19 },
  centered: { textAlign: 'center' as const },
  says: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md },
  saysText: { flex: 1, gap: 2 },
  name: { fontSize: typography.body, fontWeight: '600' as const },
});
