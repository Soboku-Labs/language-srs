# The API

The backend is the only place the domain logic runs. Clients render.

That is the point of centralising it: the FSRS scheduler, the exam-date pressure,
the queue ordering, the distractor generation and the journey thresholds exist
once, in `packages/core`, and reach every client through this API. Nobody ports a
scheduler into Swift, nobody ports it again into Kotlin, and a learner's phone and
laptop cannot disagree about when a word is due.

Base URL in development: `http://localhost:8787`.
Everything is JSON in, JSON out. Everything under `/study` needs
`Authorization: Bearer <token>`.

## Running it

```bash
npm run server          # :8787, data in ./data
DATA_DIR=/var/lib/srs PORT=8080 npm run server
ALLOWED_ORIGINS=https://yourdomain.example npm run server
```

No database. One directory per account, one file per key, written to a temporary
file and renamed into place so a process that dies mid-write leaves the previous
version intact rather than half a card list.

## Authentication

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

## Studying

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

Putting the scheduler behind a network would otherwise mean no reviews on the
Underground, which for a spaced-repetition app is a worse product. So grading is
a batch, and each grading carries the instant it actually happened:

```json
POST /study/grades
{
  "grades": [
    { "cardId": "zh-nihao:recognition", "rating": 3,
      "gradedAt": "2026-10-14T08:31:02.000Z", "durationMs": 4200 },
    { "cardId": "zh-xiexie:listening", "rating": 1,
      "gradedAt": "2026-10-14T08:31:19.000Z", "durationMs": 9100 }
  ]
}
```

A client records reviews locally while offline and replays them on reconnect. The
scheduler sees the real timestamps rather than the moment the signal returned —
which matters, because grading an hour's worth of cards at one instant tells FSRS
the learner waited an hour between each.

The batch is applied in time order whatever order it arrives in, and reported
per card: one unknown id does not discard the other nineteen.

```json
{ "applied": 19,
  "failed": [{ "cardId": "deleted:recognition", "ok": false, "error": "Unknown card" }],
  "goal": { … }, "journey": { … } }
```

`goal` and `journey` come back with every batch, so a client refreshes the day's
ring and the rank without a second call.

## Errors

Always `{code, message}`. The code is for the client to branch on, the message is
for a person to read.

| Status | Codes |
| --- | --- |
| 400 | `invalid-body`, `invalid-json`, `invalid-grade`, `invalid-language`, `unknown-action` |
| 401 | `invalid-credentials`, `unauthorised`, `expired` |
| 409 | `email-taken` |
| 413 | `too-large` |
| 422 | `weak-password` |
| 500 | `server` |

Stack traces are logged, never returned.

## What a native client owns

Only what is genuinely platform-specific:

- rendering, navigation and motion
- a local cache, and the queue of unsent gradings
- platform features — text-to-speech, haptics, home-screen widgets

Everything else — what is due, in what order, how options are generated, what a
word is worth, when a rank is earned — comes from here. A client that starts
computing an interval has reintroduced the problem this architecture exists to
prevent.
