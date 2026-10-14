import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServerHttp2Session } from 'node:http2';
import { Code, ConnectError, createClient, type Client, type Transport } from '@connectrpc/connect';
import {
  createConnectTransport,
  createGrpcTransport,
  createGrpcWebTransport,
} from '@connectrpc/connect-node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import { pb } from '@mon/api';

/**
 * The Connect API, exercised over a real socket with a generated client.
 *
 * Through a client rather than by calling handlers, because the parts most
 * likely to break are the ones a direct call skips: the enum mapping on the
 * wire, the status codes a gRPC client actually sees, the bearer header, and
 * whether the router is serving the paths the generated code asks for.
 *
 * The same calls are run over three protocols at the bottom of this file. That
 * is the claim Connect was chosen for — one process, no translating proxy — and
 * it is worth a test rather than a sentence in a comment.
 */

let dataDir: string;
let server: ReturnType<ReturnType<typeof createApp>['listen']>;
let grpcServer: ReturnType<ReturnType<typeof createApp>['listenGrpc']> | undefined;
const grpcSessions: ServerHttp2Session[] = [];
let base: string;
let transport: Transport;
let auth: Client<typeof pb.AuthService>;
let study: Client<typeof pb.StudyService>;

const portOf = (listener: { address(): unknown }): number => {
  const address = listener.address();
  return typeof address === 'object' && address ? (address as { port: number }).port : 0;
};

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'mon-connect-'));
  const app = createApp({ dataDir, allowedOrigins: ['*'] });
  server = app.listen(0);
  base = `http://127.0.0.1:${portOf(server)}`;
  transport = createConnectTransport({ baseUrl: base, httpVersion: '1.1' });
  auth = createClient(pb.AuthService, transport);
  study = createClient(pb.StudyService, transport);
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));

  /*
   * HTTP/2 sessions are long-lived, and `close()` waits for them.
   *
   * A gRPC client keeps its session open for reuse, so closing the h2 listener
   * without destroying the sessions first hangs until the test runner's hook
   * timeout — which is what it did, taking the two tests after it down with it.
   */
  for (const session of grpcSessions) session.destroy();
  grpcSessions.length = 0;
  if (grpcServer) await new Promise<void>((resolve) => grpcServer?.close(() => resolve()));
  grpcServer = undefined;

  await rm(dataDir, { recursive: true, force: true });
});

/** A registered account's bearer token. */
async function signedIn(email = 'vish@example.com'): Promise<string> {
  const { session } = await auth.register({ email, password: 'hunter2!!' });
  return session?.token ?? '';
}

const as = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

/** The code a failed call reported, for asserting on gRPC semantics rather than prose. */
async function codeOf(call: Promise<unknown>): Promise<Code | undefined> {
  try {
    await call;
    return undefined;
  } catch (cause) {
    return ConnectError.from(cause).code;
  }
}

describe('AuthService', () => {
  it('registers and hands back a usable session', async () => {
    const { session } = await auth.register({
      email: 'vish@example.com',
      password: 'hunter2!!',
      displayName: 'Vish',
    });

    expect(session?.account?.email).toBe('vish@example.com');
    expect(session?.account?.displayName).toBe('Vish');
    expect(session?.token).toBeTruthy();
    expect(session?.refreshToken).toBeTruthy();
  });

  it('maps a wrong password to Unauthenticated, not to a 401 nobody can read', async () => {
    await signedIn();
    expect(await codeOf(auth.signIn({ email: 'vish@example.com', password: 'wrong!!!!' }))).toBe(
      Code.Unauthenticated,
    );
  });

  it('gives the same answer for an unknown email as for a wrong password', async () => {
    const unknown = await codeOf(auth.signIn({ email: 'nobody@example.com', password: 'hunter2!!' }));
    await signedIn();
    const wrong = await codeOf(auth.signIn({ email: 'vish@example.com', password: 'hunter2!?' }));
    expect(unknown).toBe(wrong);
  });

  it('refuses a duplicate email as AlreadyExists and a weak password as InvalidArgument', async () => {
    await signedIn();
    expect(
      await codeOf(auth.register({ email: 'vish@example.com', password: 'hunter2!!' })),
    ).toBe(Code.AlreadyExists);
    expect(await codeOf(auth.register({ email: 'new@example.com', password: 'short' }))).toBe(
      Code.InvalidArgument,
    );
  });

  it('rotates the refresh token, so a leaked one dies when the real client uses it', async () => {
    const { session } = await auth.register({ email: 'vish@example.com', password: 'hunter2!!' });
    const first = session?.refreshToken ?? '';

    const refreshed = await auth.refresh({ refreshToken: first });
    expect(refreshed.session?.refreshToken).not.toBe(first);
    expect(await codeOf(auth.refresh({ refreshToken: first }))).toBe(Code.Unauthenticated);
  });

  it('succeeds at sign-out whether or not the token was real', async () => {
    const token = await signedIn();
    await expect(auth.signOut({}, as(token))).resolves.toBeDefined();
    // Not an error: telling a caller whether its token existed is a way to test
    // tokens.
    await expect(auth.signOut({}, as('not-a-token'))).resolves.toBeDefined();
    expect(await codeOf(study.getState({}, as(token)))).toBe(Code.Unauthenticated);
  });
});

describe('StudyService', () => {
  it('refuses every method without a token', async () => {
    expect(await codeOf(study.getState({}))).toBe(Code.Unauthenticated);
    expect(await codeOf(study.getQueue({}))).toBe(Code.Unauthenticated);
    expect(await codeOf(study.getDeck({}))).toBe(Code.Unauthenticated);
    expect(await codeOf(study.submitGrades({ grades: [] }))).toBe(Code.Unauthenticated);
    expect(await codeOf(study.cardAction({ cardId: 'x', action: pb.CardAction.BURY }))).toBe(
      Code.Unauthenticated,
    );
  });

  it('answers a fresh account with a whole home screen in one call', async () => {
    const token = await signedIn();
    const state = await study.getState({}, as(token));

    expect(state.profile?.examTrackId).toBeTruthy();
    expect(state.profile?.targetLevelId).toBeTruthy();
    expect(state.goal?.target).toBeGreaterThan(0);
    expect(state.journey?.stage?.native).toBeTruthy();
    expect(state.journey?.totalStages).toBeGreaterThan(1);
    expect(state.availableWords).toBeGreaterThan(0);
    expect(state.stats?.coverage?.available).toBe(state.availableWords);
    expect(state.readiness?.verdict).toBeTruthy();
  });

  it('starts a language the learner has never studied rather than failing', async () => {
    const token = await signedIn();
    const state = await study.getState({ languageCode: pb.LanguageCode.KO }, as(token));

    expect(state.profile?.languageCode).toBe(pb.LanguageCode.KO);
    // The Korean ladder, not the Mandarin one: the journey is per language.
    expect(state.journey?.languageCode).toBe(pb.LanguageCode.KO);
    expect(state.journey?.tradition).toBeTruthy();
  });

  it('refuses an enum value it does not have, rather than defaulting to zero', async () => {
    const token = await signedIn();
    expect(
      await codeOf(study.getState({ languageCode: 99 as pb.LanguageCode }, as(token))),
    ).toBe(Code.InvalidArgument);
    expect(await codeOf(study.setActiveLanguage({}, as(token)))).toBe(Code.InvalidArgument);
  });

  it('serves questions, not bare cards: mode, distractors and interval previews', async () => {
    const token = await signedIn();
    const queue = await study.getQueue({ limit: 5 }, as(token));

    expect(queue.questions.length).toBeGreaterThan(0);
    expect(queue.questions.length).toBeLessThanOrEqual(5);

    const question = queue.questions[0]!;
    expect(question.card?.card?.id).toContain(':');
    expect(question.card?.entry?.target).toBeTruthy();
    expect(question.mode).not.toBe(pb.AnswerMode.UNSPECIFIED);

    // A preview per rating, keyed by the rating's wire number, so a client reads
    // previews[RATING_GOOD] rather than knowing Good happens to be 3.
    expect(Object.keys(question.intervalPreviews).map(Number).sort()).toEqual([1, 2, 3, 4]);
    expect(question.intervalPreviews[pb.Rating.GOOD]).toMatch(/\d/);

    // Multiple choice means exactly one right answer among several. The whole
    // point of generating them server-side is that no client gets to disagree.
    if (question.mode === pb.AnswerMode.CHOICE) {
      expect(question.options.length).toBeGreaterThanOrEqual(3);
      expect(question.options.filter((option) => option.correct)).toHaveLength(1);
    }
  });

  it('filters the queue to one card kind', async () => {
    const token = await signedIn();
    const queue = await study.getQueue({ kind: pb.CardKind.RECOGNITION, limit: 10 }, as(token));

    expect(queue.questions.length).toBeGreaterThan(0);
    for (const question of queue.questions) {
      expect(question.card?.card?.kind).toBe(pb.CardKind.RECOGNITION);
    }
  });
});

describe('SubmitGrades — the offline path', () => {
  const firstCardId = async (token: string): Promise<string> => {
    const queue = await study.getQueue({ limit: 1 }, as(token));
    return queue.questions[0]?.card?.card?.id ?? '';
  };

  it('records a grading and moves the day along', async () => {
    const token = await signedIn();
    const cardId = await firstCardId(token);

    const result = await study.submitGrades(
      { grades: [{ cardId, rating: pb.Rating.GOOD, durationMs: 4200 }] },
      as(token),
    );

    expect(result.applied).toBe(1);
    expect(result.failed).toHaveLength(0);
    expect(result.goal?.done).toBe(1);
    expect(result.journey?.wordsKnown).toBeGreaterThanOrEqual(0);
  });

  it('replays a batch in the order it happened, not the order it arrived', async () => {
    const token = await signedIn();
    const cardId = await firstCardId(token);

    const hoursAgo = (hours: number) =>
      new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const latest = hoursAgo(2);

    /*
     * Three gradings, deliberately shuffled, ending — in real time — with
     * Again. Applied in time order, the card's next due date is computed from
     * the *latest* instant, so it lands after `latest`. Applied in array order
     * the last one written would be the 4-hours-ago Good, and the due date would
     * fall before it.
     *
     * This is the behaviour the whole centralised-scheduler design rests on: a
     * learner studies on the Underground, and the schedule it produces has to be
     * the schedule they would have got with a signal.
     */
    const result = await study.submitGrades(
      {
        grades: [
          { cardId, rating: pb.Rating.AGAIN, gradedAt: latest },
          { cardId, rating: pb.Rating.GOOD, gradedAt: hoursAgo(4) },
          { cardId, rating: pb.Rating.GOOD, gradedAt: hoursAgo(3) },
        ],
      },
      as(token),
    );

    expect(result.applied).toBe(3);

    const deck = await study.getDeck({}, as(token));
    const card = deck.entries
      .flatMap((entry) => entry.cards)
      .find((candidate) => candidate.id === cardId);

    expect(card?.reps).toBe(3);
    expect(Date.parse(card?.due ?? '')).toBeGreaterThanOrEqual(Date.parse(latest));
  });

  it('treats an unstamped grading as now, and sorts it accordingly', async () => {
    const token = await signedIn();
    const cardId = await firstCardId(token);
    const earlier = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const submittedAt = Date.now();

    /*
     * The unstamped grading is listed first. An empty `graded_at` means "now",
     * so it must be applied *last* — sorting the raw strings would file it ahead
     * of every stamped one, because "" sorts before any timestamp, and the
     * schedule would be built from three hours ago.
     */
    const result = await study.submitGrades(
      {
        grades: [
          { cardId, rating: pb.Rating.AGAIN },
          { cardId, rating: pb.Rating.GOOD, gradedAt: earlier },
        ],
      },
      as(token),
    );

    expect(result.applied).toBe(2);

    const deck = await study.getDeck({}, as(token));
    const card = deck.entries
      .flatMap((entry) => entry.cards)
      .find((candidate) => candidate.id === cardId);

    expect(Date.parse(card?.due ?? '')).toBeGreaterThanOrEqual(submittedAt);
  });

  it('reports a bad card per card, and applies the rest of the batch', async () => {
    const token = await signedIn();
    const cardId = await firstCardId(token);

    const result = await study.submitGrades(
      {
        grades: [
          { cardId, rating: pb.Rating.GOOD },
          { cardId: 'zh-nonexistent:recognition', rating: pb.Rating.GOOD },
        ],
      },
      as(token),
    );

    // One unknown id must not discard the other nineteen reviews a learner did
    // on the train.
    expect(result.applied).toBe(1);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.cardId).toBe('zh-nonexistent:recognition');
    expect(result.failed[0]?.reason).toBeTruthy();
  });

  it('reports an unusable rating per card too, rather than failing the batch', async () => {
    const token = await signedIn();
    const cardId = await firstCardId(token);

    const result = await study.submitGrades(
      {
        grades: [
          { cardId, rating: pb.Rating.GOOD },
          { cardId, rating: pb.Rating.UNSPECIFIED },
        ],
      },
      as(token),
    );

    expect(result.applied).toBe(1);
    expect(result.failed).toHaveLength(1);
  });

  it('refuses an empty batch', async () => {
    const token = await signedIn();
    expect(await codeOf(study.submitGrades({ grades: [] }, as(token)))).toBe(Code.InvalidArgument);
  });
});

describe('the deck, notes and triage', () => {
  it('searches the deck server-side so every client matches the same way', async () => {
    const token = await signedIn();
    const all = await study.getDeck({}, as(token));
    expect(all.entries.length).toBeGreaterThan(0);

    const target = all.entries[0]?.entry?.target ?? '';
    const found = await study.getDeck({ query: target }, as(token));

    expect(found.entries.length).toBeGreaterThan(0);
    expect(found.entries.length).toBeLessThanOrEqual(all.entries.length);
    expect(found.entries.some((row) => row.entry?.target === target)).toBe(true);
  });

  it('leaves `weakest` absent on an unreviewed word rather than reporting 0.0', async () => {
    const token = await signedIn();
    const deck = await study.getDeck({ status: pb.DeckStatus.NEW }, as(token));
    const row = deck.entries[0];

    expect(row?.status).toBe(pb.DeckStatus.NEW);
    // 0.0 would read as "certainly forgotten" for a word nobody has seen.
    expect(row?.weakest).toBeUndefined();
  });

  it('saves a learner note against a word', async () => {
    const token = await signedIn();
    const deck = await study.getDeck({}, as(token));
    const entryId = deck.entries[0]?.entry?.id ?? '';

    const saved = await study.setNote({ entryId, note: 'the gate radical, twice' }, as(token));
    expect(saved.entry?.mnemonic).toBe('the gate radical, twice');

    expect(await codeOf(study.setNote({ entryId: '', note: 'x' }, as(token)))).toBe(
      Code.InvalidArgument,
    );
  });

  it('returns struggling cards as a list, empty for an account with no history', async () => {
    const token = await signedIn();
    const struggling = await study.getStruggling({ limit: 5 }, as(token));
    expect(struggling.cards).toEqual([]);
  });
});

describe('profile and language', () => {
  it('writes only the fields the mask names', async () => {
    const token = await signedIn();
    const before = (await study.getState({}, as(token))).profile!;

    const { profile } = await study.updateProfile(
      {
        profile: { ...before, dailyNewLimit: 7, dailyReviewLimit: 999 },
        updateMask: ['daily_new_limit'],
      },
      as(token),
    );

    expect(profile?.dailyNewLimit).toBe(7);
    // Sent, not named, so not written: two devices with stale copies must not
    // overwrite each other's unrelated settings on every save.
    expect(profile?.dailyReviewLimit).toBe(before.dailyReviewLimit);
  });

  it('refuses a mask naming something a client may not write', async () => {
    const token = await signedIn();
    const before = (await study.getState({}, as(token))).profile!;

    expect(
      await codeOf(
        study.updateProfile({ profile: before, updateMask: ['language_code'] }, as(token)),
      ),
    ).toBe(Code.InvalidArgument);
    expect(
      await codeOf(study.updateProfile({ profile: before, updateMask: [] }, as(token))),
    ).toBe(Code.InvalidArgument);
  });

  it('sets an exam date and reports the pace it implies', async () => {
    const token = await signedIn();
    const before = (await study.getState({}, as(token))).profile!;
    const inNinetyDays = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);

    await study.updateProfile(
      { profile: { ...before, examDate: inNinetyDays }, updateMask: ['exam_date'] },
      as(token),
    );

    const { readiness } = await study.getState({}, as(token));
    expect(readiness?.examDate).toBe(inNinetyDays);
    expect(readiness?.daysToExam).toBeGreaterThan(80);
    // The two numbers behind `pace_is_sufficient`, because the bare boolean is
    // not something a learner can act on.
    expect(readiness?.requiredNewPerDay).toBeGreaterThan(0);
    expect(readiness?.plannedNewPerDay).toBe(before.dailyNewLimit);
  });

  it('switches the active language and remembers it', async () => {
    const token = await signedIn();
    await study.setActiveLanguage({ languageCode: pb.LanguageCode.JA }, as(token));

    const state = await study.getState({}, as(token));
    expect(state.profile?.languageCode).toBe(pb.LanguageCode.JA);
    expect(state.studiedLanguages).toContain(pb.LanguageCode.JA);
  });
});

describe('ImportVocabulary', () => {
  it('parses CSV server-side so no client needs a CSV reader', async () => {
    const token = await signedIn();
    const result = await study.importVocabulary(
      {
        source: {
          case: 'text',
          value: 'mon-test-1,門口,ménkǒu,doorway,hsk3-1,noun\n',
        },
        format: 'csv',
        languageCode: pb.LanguageCode.ZH,
        defaultLevelId: 'hsk3-1',
      },
      as(token),
    );

    expect(result.added).toBe(1);
    expect(result.accepted).toBe(1);
    expect(result.rejected).toBe(0);

    const found = await study.getDeck({ query: '門口' }, as(token));
    expect(found.entries.some((row) => row.entry?.id === 'mon-test-1')).toBe(true);
  });

  it('reports a bad row with its number, which is the only form anyone can fix', async () => {
    const token = await signedIn();
    const result = await study.importVocabulary(
      {
        source: { case: 'text', value: ',,,,\n' },
        format: 'csv',
        languageCode: pb.LanguageCode.ZH,
        defaultLevelId: 'hsk3-1',
      },
      as(token),
    );

    // Not an error: the client has to show the learner which rows were wrong.
    expect(result.added).toBe(0);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues[0]?.row).toBeGreaterThan(0);
    expect(result.issues[0]?.message).toBeTruthy();
  });

  it('takes already-parsed entries too', async () => {
    const token = await signedIn();
    const result = await study.importVocabulary(
      {
        source: {
          case: 'entries',
          value: {
            entries: [
              {
                id: 'mon-test-2',
                languageCode: pb.LanguageCode.ZH,
                target: '門票',
                reading: 'ménpiào',
                meanings: ['entrance ticket'],
                levelIds: ['hsk3-1'],
                examples: [],
                tones: [2, 4],
                tags: [],
              },
            ],
          },
        },
      },
      as(token),
    );

    expect(result.added).toBe(1);
  });

  it('refuses an import with no source', async () => {
    const token = await signedIn();
    expect(await codeOf(study.importVocabulary({ format: 'csv' }, as(token)))).toBe(
      Code.InvalidArgument,
    );
  });
});

describe('CardAction', () => {
  const firstCardId = async (token: string): Promise<string> => {
    const queue = await study.getQueue({ limit: 1 }, as(token));
    return queue.questions[0]?.card?.card?.id ?? '';
  };

  it('suspends and restores a card, returning the card as it now stands', async () => {
    const token = await signedIn();
    const cardId = await firstCardId(token);

    const suspended = await study.cardAction({ cardId, action: pb.CardAction.SUSPEND }, as(token));
    expect(suspended.ok).toBe(true);
    expect(suspended.card?.suspended).toBe(true);

    const restored = await study.cardAction({ cardId, action: pb.CardAction.UNSUSPEND }, as(token));
    expect(restored.card?.suspended).toBe(false);
  });

  it('resets a card back to new', async () => {
    const token = await signedIn();
    const cardId = await firstCardId(token);
    await study.submitGrades({ grades: [{ cardId, rating: pb.Rating.GOOD }] }, as(token));

    const reset = await study.cardAction({ cardId, action: pb.CardAction.RESET }, as(token));
    expect(reset.card?.state).toBe(pb.CardState.NEW);
    expect(reset.card?.reps).toBe(0);
  });

  it('undoes the last grading, and says so when there is nothing left to undo', async () => {
    const token = await signedIn();
    const cardId = await firstCardId(token);
    await study.submitGrades({ grades: [{ cardId, rating: pb.Rating.GOOD }] }, as(token));

    const undone = await study.cardAction({ action: pb.CardAction.UNDO_LAST_GRADE }, as(token));
    expect(undone.ok).toBe(true);

    const again = await study.cardAction({ action: pb.CardAction.UNDO_LAST_GRADE }, as(token));
    expect(again.ok).toBe(false);
  });

  it('needs a card id for the actions that act on one', async () => {
    const token = await signedIn();
    expect(await codeOf(study.cardAction({ action: pb.CardAction.SUSPEND }, as(token)))).toBe(
      Code.InvalidArgument,
    );
    expect(
      await codeOf(study.cardAction({ cardId: 'x', action: pb.CardAction.UNSPECIFIED }, as(token))),
    ).toBe(Code.InvalidArgument);
  });
});

describe('one service, three protocols', () => {
  /**
   * The reason Connect was chosen over raw gRPC.
   *
   * A browser cannot speak gRPC — HTTP/2 trailers are not exposed to JavaScript
   * — so the usual answer is an Envoy sidecar translating gRPC-Web, which is a
   * second process to deploy, configure and monitor for one web app. Connect
   * serves all three from this one process, and these three tests are what makes
   * that a fact rather than a claim in a design document.
   */
  it('answers over the Connect protocol with JSON on the wire', async () => {
    const token = await signedIn();
    const json = createClient(
      pb.StudyService,
      createConnectTransport({ baseUrl: base, httpVersion: '1.1', useBinaryFormat: false }),
    );

    expect((await json.getState({}, as(token))).profile?.targetLevelId).toBeTruthy();
  });

  it('answers over the Connect protocol with binary protobuf on the wire', async () => {
    const token = await signedIn();
    const binary = createClient(
      pb.StudyService,
      createConnectTransport({ baseUrl: base, httpVersion: '1.1', useBinaryFormat: true }),
    );

    expect((await binary.getState({}, as(token))).profile?.targetLevelId).toBeTruthy();
  });

  it('answers over gRPC-Web, which is what a browser behind a strict proxy gets', async () => {
    const token = await signedIn();
    const web = createClient(
      pb.StudyService,
      createGrpcWebTransport({ baseUrl: base, httpVersion: '1.1' }),
    );

    expect((await web.getState({}, as(token))).profile?.targetLevelId).toBeTruthy();
  });

  it('answers real gRPC over HTTP/2 on the second listener', async () => {
    const token = await signedIn();

    // gRPC carries its status in trailers, and trailers need HTTP/2 — which node
    // cannot serve on the same cleartext port as HTTP/1.1. Hence a second
    // listener, and hence this test, which is the only thing proving a Go
    // service or `grpcurl` could talk to this server at all.
    grpcServer = createApp({ dataDir, allowedOrigins: ['*'] }).listenGrpc(0);
    grpcServer.on('session', (session) => grpcSessions.push(session));
    await new Promise((resolve) => grpcServer?.once('listening', resolve));

    const grpc = createClient(
      pb.StudyService,
      createGrpcTransport({ baseUrl: `http://127.0.0.1:${portOf(grpcServer)}` }),
    );

    expect((await grpc.getState({}, as(token))).profile?.targetLevelId).toBeTruthy();
    expect(await codeOf(grpc.getState({}))).toBe(Code.Unauthenticated);
  });

  it('still serves the JSON routes and /health beside the RPCs', async () => {
    const token = await signedIn();

    expect(await (await fetch(`${base}/health`)).json()).toEqual({ ok: true });

    const legacy = await fetch(`${base}/study/state`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(legacy.status).toBe(200);
    const state = (await legacy.json()) as { profile: { targetLevelId: string } };
    expect(state.profile.targetLevelId).toBeTruthy();
  });

  it('allows the headers a Connect browser client sends, on preflight', async () => {
    const response = await fetch(`${base}/mon.v1.StudyService/GetState`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://example.com' },
    });

    expect(response.status).toBe(204);
    const allowed = response.headers.get('access-control-allow-headers') ?? '';
    // Without this one the preflight fails and the RPC is never sent — the kind
    // of break that looks like a server outage from the browser console.
    expect(allowed).toContain('Connect-Protocol-Version');
    expect(allowed).toContain('Authorization');
    expect(response.headers.get('access-control-allow-origin')).toBe('https://example.com');
  });
});
