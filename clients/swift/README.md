# The Swift client

Everything an iOS app needs to talk to `apps/server`: sign in, read the published
word lists, and sync a deck between devices. It holds **no study logic** and
never will — the scheduler lives in one place, and a second implementation of
FSRS written to make an iPhone build work is the exact failure the architecture
exists to prevent.

```bash
swift test                                        # the merge rules
npm run server                                    # :4000, in another shell
LANGUAGESRS_API=http://localhost:4000 swift test  # and against the real thing
```

The integration tests skip themselves when `LANGUAGESRS_API` is unset, so a
clone with no backend running still has a green build.

## This is a library, not an app

There is no SwiftUI here, and that is a limit of where it is built rather than a
design choice. SwiftUI is Apple-platform only; this package is compiled and
tested on Linux with the open-source toolchain, which has Foundation but no UI
framework. Everything in it is the part an app would be built *on*, and all of
it is exercised by tests.

The UI needs a Mac. When somebody opens it in Xcode, this package is a local
dependency and the client is ready to call.

## Zero dependencies

Foundation only: `Codable` for JSON, `URLSession` for HTTP. Every dependency is
something an iOS app has to carry, audit and update, and a networking package
would be a poor trade for the dozen lines of request building it saves.

One shim: `URLSession.data(for:)`'s async overload is not available in
Foundation on every platform this targets, so it is wrapped by hand with a
continuation. Identical behaviour, compiles everywhere.

## Merging, which is the point of this library

`StateService` on the server says its 409 exists "so the app can decide rather
than silently clobbering another device". `StateMerge` is that decision, and it
is **the same decision `clients/kotlin` makes** — deliberately, assertion for
assertion. Two apps that resolved the same conflict differently would produce two
different accounts.

| State | Rule | Why |
| --- | --- | --- |
| Review logs | **Union, by id** | Append-only and uniquely identified, so there is no conflict to resolve. A learner who studied on both devices did all of that work, and this is the one thing here that cannot be recreated. |
| Cards | **The server's copy** | They look derivable from the reviews and are not: the scheduler fuzzes due dates, so replaying the same reviews on two devices lands them a day or two apart with neither wrong. |
| Everything else | **The server's copy** | Small, and a learner who changed their daily limit on their phone meant it. |

A key only one side has is **kept**. A server that has never seen imported
vocabulary is not issuing an instruction to throw it away.

## Why the models are hand-written

The server speaks JSON today. Generating these from a `.proto` is the right end
state and would mean describing a server that does not exist yet.

Writing the Kotlin equivalents from reading the TypeScript produced two mistakes,
both of which compiled perfectly and failed *silently*:

- The 409 body nests the account's state under `current`, beside the error
  fields. Decoding it as a bare `AccountState` succeeds and yields revision 0, so
  a client with this wrong retries against revision 0 forever.
- A sitting records `recalled` and `activeMs`, not `correct` and `durationMs`. A
  near-miss decodes to a default rather than throwing, which is how a streak
  quietly reads zero.

Both are why the integration tests run against a real server, and why this
package's shapes were written from the corrected Kotlin ones rather than from the
TypeScript a second time.
