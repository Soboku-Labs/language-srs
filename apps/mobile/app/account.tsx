import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  formatDuration,
  getLanguageProfile,
  getTeacher,
  type AuthSessionInfo,
} from '@language-srs/core';
import { useAuth } from '../src/auth/AuthProvider';
import { useSync } from '../src/auth/SyncProvider';
import { useEngine } from '../src/engine/EngineProvider';
import { BigButton, Caption, DetailRow, Row, Screen, Section, Stat, TextButton, Title } from '../src/components/ui';
import { TeacherAvatar } from '../src/components/Teacher';
import { Rise } from '../src/motion/components';
import { spacing, typography, useTheme, useThemedStyles, type ResolvedTheme } from '../src/theme';

/**
 * The account.
 *
 * Three questions, in the order they get asked: who am I signed in as, is my
 * study actually being kept, and where else is this account open. The study
 * history sits here rather than on Progress because it is a fact about the
 * account across devices, where Progress is about the language in front of you.
 */
export default function AccountScreen() {
  const { status, user, signOut, signOutOthers, listSessions, revokeSession, offline } = useAuth();
  const { state: syncState, lastSyncedAt, message, syncNow } = useSync();
  const { engine, revision } = useEngine();
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const router = useRouter();

  const [devices, setDevices] = useState<AuthSessionInfo[]>([]);
  const [devicesProblem, setDevicesProblem] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const summary = useMemo(() => {
    return engine.getSessionSummary({ days: 30, recentLimit: 8 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, revision]);

  const refreshDevices = useCallback(async () => {
    if (status !== 'signed-in') return;
    try {
      setDevices(await listSessions());
      setDevicesProblem(undefined);
    } catch {
      setDevicesProblem('Could not reach the server, so this list may be out of date.');
    }
  }, [listSessions, status]);

  useEffect(() => {
    void refreshDevices();
  }, [refreshDevices]);

  // Signed out: the history is still here — it is on this device — so show it,
  // and offer the account as the thing that would keep it safe.
  if (status !== 'signed-in' || !user) {
    return (
      <Screen>
        <Rise index={0} style={styles.header}>
          <Title>Studying without an account</Title>
          <Caption>
            Everything you have studied is on this device and stays there. An account keeps it in step with your other
            devices, and means a lost phone is not a lost streak.
          </Caption>
        </Rise>

        <Rise index={1}>
          <BigButton label="Sign in or create an account" onPress={() => router.push('/sign-in')} />
        </Rise>

        <Rise index={2}>
          <History summary={summary} />
        </Rise>
      </Screen>
    );
  }

  return (
    <Screen>
      <Rise index={0} style={styles.identity}>
        <View style={styles.avatar}>
          <Text style={[styles.avatarLetter, { color: theme.colors.accent }]}>
            {user.displayName.slice(0, 1).toUpperCase()}
          </Text>
        </View>
        <View style={styles.identityText}>
          <Title>{user.displayName}</Title>
          <Caption>{user.email}</Caption>
        </View>
      </Rise>

      <Rise index={1}>
        <Section title="Syncing">
          <DetailRow label="Status" value={describeSync(syncState, offline)} />
          <DetailRow label="Last synced" value={lastSyncedAt ? describeWhen(lastSyncedAt) : 'not yet'} />
          {message ? <Caption>{message}</Caption> : null}
          <TextButton
            label={syncState === 'syncing' ? 'Syncing…' : 'Sync now'}
            onPress={() => void syncNow().then(refreshDevices)}
          />
          <Caption>
            Your cards, schedule and history are kept per account. Studying always works offline — this device catches
            up when it can.
          </Caption>
        </Section>
      </Rise>

      <Rise index={2}>
        <History summary={summary} />
      </Rise>

      <Rise index={3}>
        <Section title={`Signed in on ${devices.length} device${devices.length === 1 ? '' : 's'}`}>
          {devices.map((device) => (
            <View key={device.id} style={styles.device}>
              <View style={styles.deviceText}>
                <Text style={styles.deviceName}>
                  {device.device}
                  {device.current ? ' · this one' : ''}
                </Text>
                <Text style={styles.deviceMeta}>
                  last used {describeWhen(device.lastSeenAt)} · signed in {describeWhen(device.createdAt)}
                </Text>
              </View>
              {device.current ? null : (
                <TextButton
                  label="Revoke"
                  color={theme.colors.danger}
                  onPress={() =>
                    void revokeSession(device.id)
                      .then(refreshDevices)
                      .catch(() => setDevicesProblem('Could not revoke that session.'))
                  }
                />
              )}
            </View>
          ))}
          {devicesProblem ? <Caption>{devicesProblem}</Caption> : null}
          {devices.length > 1 ? (
            <TextButton
              label="Sign out everywhere else"
              onPress={() => {
                setBusy(true);
                void signOutOthers()
                  .then(refreshDevices)
                  .catch(() => setDevicesProblem('Could not reach the server.'))
                  .finally(() => setBusy(false));
              }}
            />
          ) : null}
        </Section>
      </Rise>

      <Rise index={4}>
        <TextButton
          label={busy ? 'Working…' : 'Sign out on this device'}
          color={theme.colors.danger}
          onPress={() => {
            void signOut().then(() => router.replace('/'));
          }}
        />
        <Caption>
          Signing out leaves this account&apos;s cards on the server and returns this device to studying without an
          account. Nothing is deleted.
        </Caption>
      </Rise>
    </Screen>
  );
}

/** Sittings, which is what "session tracking" means to the person who did them. */
function History({ summary }: { summary: ReturnType<ReturnType<typeof useEngine>['engine']['getSessionSummary']> }) {
  const styles = useThemedStyles(createStyles);
  const theme = useTheme();

  if (summary.sessions === 0) {
    return (
      <Section title="Study history">
        <Caption>No sittings in the last 30 days. One appears here as soon as you finish a session.</Caption>
      </Section>
    );
  }

  return (
    <Section title="Last 30 days">
      <Row style={styles.stats}>
        <Stat label={summary.sessions === 1 ? 'sitting' : 'sittings'} value={String(summary.sessions)} />
        <Stat label="cards" value={String(summary.reviewed)} />
        <Stat label="recalled" value={`${Math.round(summary.accuracy * 100)}%`} color={theme.colors.good} />
        <Stat label="time" value={formatDuration(summary.activeMs)} />
      </Row>

      {summary.recent.map((session) => {
        const language = getLanguageProfile(session.languageCode);
        const teacher = getTeacher(session.languageCode);
        return (
          <View key={session.id} style={styles.sitting}>
            <TeacherAvatar teacher={teacher} size="small" />
            <View style={styles.sittingText}>
              <Text style={styles.sittingTitle}>
                {language.name} · {session.reviewed} card{session.reviewed === 1 ? '' : 's'}
              </Text>
              <Text style={styles.sittingMeta}>
                {describeWhen(session.startedAt)} · {formatDuration(session.activeMs)} ·{' '}
                {Math.round((session.recalled / Math.max(1, session.reviewed)) * 100)}% recalled
                {session.device ? ` · ${session.device}` : ''}
              </Text>
            </View>
          </View>
        );
      })}

      {summary.recent.some((session) => session.derived) ? (
        <Caption>
          Sittings marked from older history were reconstructed from your review log, so their start times are
          approximate.
        </Caption>
      ) : null}
    </Section>
  );
}

function describeSync(state: string, offline: boolean): string {
  if (offline && state !== 'synced') return 'offline — will catch up';
  switch (state) {
    case 'syncing':
      return 'syncing…';
    case 'synced':
      return 'up to date';
    case 'offline':
      return 'offline — will catch up';
    case 'error':
      return 'last attempt failed';
    default:
      return 'waiting';
  }
}

/** "4 minutes ago", "yesterday" — a timestamp as somebody would say it. */
function describeWhen(at: string): string {
  const minutes = Math.round((Date.now() - Date.parse(at)) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(at).toISOString().slice(0, 10);
}

const createStyles = (theme: ResolvedTheme) => ({
  header: { gap: spacing.sm, paddingTop: spacing.lg },
  identity: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md, paddingTop: spacing.lg },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: theme.colors.accentSoft,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  avatarLetter: { fontSize: typography.title, fontWeight: '600' as const },
  identityText: { flex: 1, gap: 1 },

  stats: { justifyContent: 'space-between' as const },

  device: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md },
  deviceText: { flex: 1, gap: 1 },
  deviceName: { color: theme.colors.text, fontSize: typography.body, fontWeight: '600' as const },
  deviceMeta: { color: theme.colors.textMuted, fontSize: typography.micro },

  sitting: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md },
  sittingText: { flex: 1, gap: 1 },
  sittingTitle: { color: theme.colors.text, fontSize: typography.caption, fontWeight: '600' as const },
  sittingMeta: { color: theme.colors.textMuted, fontSize: typography.micro },
});
