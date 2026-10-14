# The API

The backend is the only place the domain logic runs. Clients render.

That is the point of centralising it: the FSRS scheduler, the exam-date pressure,
the queue ordering, the distractor generation and the journey thresholds exist
once, in `packages/core`, and reach every client through this API. Nobody ports a
scheduler into Swift, nobody ports it again into Kotlin, and a learner's phone and
laptop cannot disagree about when a word is due.

The contract is [`proto/mon/v1/mon.proto`](../proto/mon/v1/mon.proto), served
over [Connect](https://connectrpc.com). Everything on `StudyService` needs
`Authorization: Bearer <token>`.

Base URL in development: `http://localhost:8787`.

## Running it

```bash
npm run server          # :8787, data in ./data
DATA_DIR=/var/lib/srs PORT=8080 npm run server
ALLOWED_ORIGINS=https://yourdomain.example npm run server
```

No database. One directory per account, one file per key, written to a temporary
file and renamed into place so a process that dies mid-write leaves the previous
version intact rather than half a card list.

## Why Connect and not gRPC

**A browser cannot speak gRPC.** HTTP/2 trailers are not exposed to JavaScript,
so gRPC-Web needs either a translating proxy in front of the server or a server
that speaks it natively. Running an Envoy sidecar to serve one web app is a real
operational cost — a second process to deploy, configure, monitor and upgrade —
for nothing the web app can feel.

Connect serves the same `.proto` over **three** protocols from one process, and
each one is covered by a test in `apps/server/src/connect.test.ts`:

| Protocol | Who uses it | Listener |
| --- | --- | --- |
| Connect, binary protobuf | `connect-swift`, `connect-kotlin` | `listen()` — HTTP/1.1 |
| Connect, JSON | the browser, and `curl` | `listen()` — HTTP/1.1 |
| gRPC-Web | a browser behind a strict proxy | `listen()` — HTTP/1.1 |
| gRPC | a Go service, `grpcurl`, a mesh | `listenGrpc()` — HTTP/2 |

The phones get binary protobuf bodies over ordinary HTTP, which is where the
size and parse win actually comes from — not from HTTP/2.

**gRPC needs a second listener**, because it carries its status in trailers,
trailers need HTTP/2, and node cannot serve cleartext HTTP/2 and HTTP/1.1 on the
same port. `allowHTTP1` works only on a TLS listener, where ALPN negotiates; on a
plain socket `http2.createServer` speaks h2c and nothing else, and an HTTP/1.1
client gets a binary frame where it expected a status line. So `listen()` is the
one to run, and `listenGrpc()` is for when something genuinely speaks gRPC.

## Calling it

Code generation is committed, so a clone builds without the `buf` binary:

```bash
npm run proto:lint       # buf lint, STANDARD
npm run proto:generate   # -> apps/server/src/gen/
npm run proto:breaking   # against main, before anything ships
```

`buf breaking` is what stops a field number being reused or a type changing
underneath a shipped iOS build — the failure mode protobuf exists to prevent, and
the one nobody notices until a client in the wild starts decoding garbage.

Because Connect also speaks plain HTTP/JSON, every RPC is reachable with `curl`,
which matters more during an incident than it sounds:

```bash
curl -X POST http://localhost:8787/mon.v1.AuthService/SignIn \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"…"}'

curl -X POST http://localhost:8787/mon.v1.StudyService/GetState \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" -d '{}'
```

## The services

`AuthService`: `Register`, `SignIn`, `Refresh`, `SignOut`.

`StudyService`: `GetState`, `GetQueue`, `SubmitGrades`, `GetDeck`,
`GetStruggling`, `UpdateProfile`, `SetActiveLanguage`, `ImportVocabulary`,
`SetNote`, `CardAction`, `PullState`.

Three things are worth knowing about the shapes, because they are decisions
rather than conventions:

- **`GetState` is one round trip** by design. A client assembling a dashboard
  from six requests shows six loading states and fails in six ways.
- **`GetQueue` returns questions, not cards.** Each carries its entry, its answer
  mode, its distractors and the interval each rating would produce. Three
  implementations of "which wrong answers are plausible" would drill three
  different exams, so the assembly is `buildQuestion` in the core and every
  client — including the web app — renders what it is handed.
- **`UpdateProfile` honours `update_mask` strictly.** A client sends a whole
  profile and names the fields it means. Without it, two devices with stale
  copies would overwrite each other's unrelated settings on every save.

## The JSON routes

The hand-rolled routes below are still served, as Connect's fallback, and are
what `HttpAuthProvider` in `@mon/core` was written against. They call the same
`Accounts` and the same per-account engine — a second doorway, not a second
implementation. New clients should use the RPCs.

### Authentication

Paths and response shape match `HttpAuthProvider` in `@mon/core`, which
was written against this contract before the server existed.

| Route | Body | Returns |
| --- | --- | --- |
| `POST /auth/register` | `{email, password, displayName?}` | `201` session |
| `POST /auth/sign-in` | `{email, password}` | `200` session |
| `POST /auth/refresh` | `{refreshToken}` | `200` session |
| `POST /auth/sign-out` | — (bearer) | `204` |

A session is `{account, token, refreshToken, expiresAt}`.

Tokens are opaque and stored server-side rather than signed, because a JWT cannot
be revoked before it expires and "sign out everywhere" has to be able to.
Refresh rotates: the old refresh token stops working the moment the real client
uses it, so a leaked one is good for one request at most.

Passwords are scrypt with a per-account salt, from Node's own crypto. A wrong
password and an unknown account return the identical error, after the identical
work — otherwise the endpoint is an oracle for which addresses are registered.

### Studying

| Route | Purpose |
| --- | --- |
| `GET /study/state?language=zh` | Everything a home screen needs, in one call |
| `GET /study/queue?mode=&kind=&limit=` | The cards to study, each with its entry |
| `POST /study/grades` | Record one grading, or a batch |
| `GET /study/deck?language=zh` | One row per word |
| `GET /study/struggling` | The words that are fighting the learner |
| `PATCH /study/profile?language=zh` | Daily limits, target level, exam date |
| `POST /study/language` | `{languageCode}` |
| `POST /study/import` | `{entries}` or `{text, format, languageCode, defaultLevelId}` |
| `POST /study/note` | `{entryId, note}` |
| `POST /study/cards/:id/action` | `{action}` — suspend, unsuspend, bury, reset, clear-leech, undo |

`GET /study/state` is deliberately one round trip. A client assembling a dashboard
from six requests shows six loading states and fails in six ways.

`GET /study/queue` returns cards *with* their entries, so no client needs a second
lookup to draw a card — and none needs its own copy of the distractor logic,
because the options come from core.

## Studying offline

This is the part the whole arrangement is built around. Putting the scheduler
behind a network would otherwise mean no reviews on the Underground, which for a
spaced-repetition app is a worse product.

So `SubmitGrades` takes a **batch**, and each grading carries the instant it
actually happened:

```json
POST /mon.v1.StudyService/SubmitGrades
{
  "grades": [
    { "cardId": "zh-nihao:recognition", "rating": "RATING_GOOD",
      "gradedAt": "2026-10-14T08:31:02.000Z", "durationMs": 4200 },
    { "cardId": "zh-xiexie:listening", "rating": "RATING_AGAIN",
      "gradedAt": "2026-10-14T08:31:19.000Z", "durationMs": 9100 }
  ]
}
```

A client records reviews locally while offline and replays them on reconnect. The
scheduler sees the real timestamps rather than the moment the signal returned —
which matters, because grading an hour's worth of cards at one instant tells FSRS
the learner waited an hour between each.

Three rules, all load-bearing:

- **Applied in time order**, whatever order the batch arrives in, because the
  scheduler's output depends on the order and an offline queue arrives in
  whatever order the client stored it. An empty `gradedAt` means *now*, and is
  resolved to an instant before sorting — sorting the raw strings would file
  every unstamped grading ahead of every stamped one.
- **Reported per card**, so one unknown id does not discard the other nineteen
  reviews a learner did on the train. A rating the server cannot read is reported
  the same way rather than failing the batch.
- **Idempotent on `id`**, which is what makes a retry safe. Send the review log
  id you generated locally. Without it the offline path has a hole big enough to
  lose a schedule through: a connection that times out *after* the server applied
  the batch leaves the client unable to tell success from failure, and the only
  choices are to drop the reviews or to count them twice. Twice is worse — it
  inflates the streak, skews retention, and pushes every card further out than
  the learner earned.

```json
{ "applied": 19,
  "duplicates": 2,
  "failed": [{ "cardId": "deleted:recognition", "reason": "Unknown card" }],
  "goal": { … }, "journey": { … } }
```

`duplicates` counts gradings this server had already applied. It is a **success**,
reported separately so a client can tell "your retry worked the first time" from
"nothing was recorded".

`goal` and `journey` come back with every batch, so a client refreshes the day's
ring and the rank without a second call.

## Syncing a client that keeps its own copy

`SubmitGrades` is the push half. `PullState` is the other one, and together they
are the whole sync protocol — there is no `PushState`, because pushing is what the
existing RPCs already do: gradings through `SubmitGrades`, imported words through
`ImportVocabulary`, settings through `UpdateProfile`. A second way to write the
same state would be a second thing to keep correct.

```
PullState({ since: cursor, limit: 500 })
  -> { cards, profiles, activeLanguage, entries, reviews, cursor, more }
```

**Push before you pull.** The other order looks equivalent and loses work: the
pull overwrites local cards with the server's, and the server has not seen this
device's reviews yet — so a card the learner just graded is replaced by its
pre-grading state.

**Cards come back whole, and the server's win.** Card state looks like a pure
function of the reviews applied to it, so a client could in principle replay the
log and skip the transfer. It cannot: the scheduler fuzzes due dates so a hundred
cards learned on one evening do not all return on one evening, and two devices
replaying the same reviews land a day or two apart, forever, with neither of them
wrong. One side has to be the answer and the server is the one every device can
reach.

**Reviews are a union, by id.** Append-only and uniquely identified, so there is
no conflict to resolve. They come down as well as up because streaks, retention
and the per-kind breakdown are computed from them, and a device holding only its
own half under-reports a learner's streak — which is the one number people
actually mind being wrong.

The cursor is **opaque**. It is `reviewedAt|id` today and a client that parses it
will break when it is not. The id is in there because two gradings can share an
instant, and a timestamp-only cursor skips the second one permanently.

`@mon/api` implements all of this — see `sync()` — so a client calls one function
rather than reimplementing the ordering rules.

## Errors

Connect has its own code space, and a gRPC client sees those codes rather than an
HTTP status line — a Swift client checking for `409` would be reading a number
that never reaches it. So the domain's statuses are translated once, in
`apps/server/src/connect/errors.ts`:

| Thrown as | Reaches the client as |
| --- | --- |
| 400 invalid body, grade, language, action | `invalid_argument` |
| 401 bad credentials, unknown or stale token | `unauthenticated` |
| 404 no such entry | `not_found` |
| 409 email already registered | `already_exists` |
| 413 body over 8MB | `resource_exhausted` |
| 422 weak password | `invalid_argument` |
| anything unrecognised | `internal`, with a generic message |

An unknown enum value is `invalid_argument` rather than a silent fall back to the
zero value: a client talking about a `CardKind` this server does not have is
either a newer build or a corrupted request, and scheduling *something* would be
worse than failing.

Stack traces are logged, never returned. The JSON routes keep returning
`{code, message}` with their original statuses.

## What a native client owns

Only what is genuinely platform-specific:

- rendering, navigation and motion
- a local cache, and the queue of unsent gradings
- platform features — text-to-speech, haptics, home-screen widgets

Everything else — what is due, in what order, how options are generated, what a
word is worth, when a rank is earned — comes from here.

The thing to avoid is a second *implementation* of the scheduler, not a second
process that runs it. A SwiftUI or Compose client cannot run `packages/core`, so
it renders what this API gives it; the web app can, so it does, and syncs through
`PullState` instead. Both arrangements have one FSRS in one language, which is
the whole point. `docs/ARCHITECTURE-DECISIONS.md` has the full rule.
