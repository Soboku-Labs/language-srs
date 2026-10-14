# The Kotlin client

Everything an Android app needs to talk to `apps/server`: sign in, read the
published word lists, and sync a deck between devices. It holds **no study
logic** and never will — the scheduler lives in one place, and a second
implementation of FSRS written to make an Android build work is the exact
failure the architecture exists to prevent.

```bash
gradle test                                        # the merge rules
npm run server                                     # :4000, in another shell
LANGUAGESRS_API=http://localhost:4000 gradle test  # and against the real thing
```

The integration tests skip themselves when `LANGUAGESRS_API` is unset, so a
clone with no backend running still has a green build.

## Merging, which is the point of this library

`StateService` on the server says its 409 exists "so the app can decide rather
than silently clobbering another device". `StateMerge` is that decision, and
until now nothing implemented it — a conflict meant one side's study was thrown
away by whoever retried last.

The rules differ per key, and the asymmetry is the whole design:

| State | Rule | Why |
| --- | --- | --- |
| Review logs | **Union, by id** | Append-only and uniquely identified, so there is no conflict to resolve. A learner who studied on both devices did all of that work. Streaks and retention are computed from this, and it is the one thing here that cannot be recreated. |
| Cards | **The server's copy** | They look derivable from the reviews and are not: the scheduler fuzzes due dates, so replaying the same reviews on two devices lands them a day or two apart with neither wrong. Somebody has to be the answer. |
| Everything else | **The server's copy** | Profiles and settings are small, and a learner who changed their daily limit on their phone meant it. |

A key only one side has is **kept**, not deleted. A server that has never seen
imported vocabulary is not issuing an instruction to throw it away.

## Why these models are hand-written

The obvious alternative is generating them from a `.proto`, and that is the
right end state. The server speaks JSON today, and inventing a contract it does
not implement would be describing a server that does not exist.

Two of these shapes were wrong when written from reading the TypeScript, and the
integration tests caught both:

- The 409 body nests the account's state under `current`, beside the error
  fields. Decoding it as a bare `AccountState` *succeeds* and yields revision 0,
  so a client with this wrong would retry against revision 0 forever.
- A sitting records `recalled` and `activeMs`, not `correct` and `durationMs`. A
  near-miss decodes to a default rather than failing, which is how a streak
  quietly reads zero.

Neither is the kind of mistake a unit test against handmade JSON can find, which
is why the integration tests exist and why they run against a real server.

## What is deliberately missing

An Android app. This is the client library it would be built on; the UI is a
separate piece of work and needs the Android SDK, which is not what this module
is. There is also no iOS equivalent yet — see the note in
`docs/ARCHITECTURE-DECISIONS.md` about what a native client needs from the
backend before it can be thin.
