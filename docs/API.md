# The account API

A small HTTP service in `apps/server`. It exists so that a learner's schedule,
history and streak belong to *them* rather than to a phone — and so that "how
much have I actually been studying?" has an answer that survives a lost device.

Studying does not depend on it. The app is local-first and always has been: an
account is something that happens to your study, not something it waits for.

```bash
npm run server        # http://localhost:4000, accounts in .data/accounts.json
npm run server:dev    # the same, restarting on change
npm run server:test   # 60 tests over auth, storage and the HTTP surface
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `4000` | |
| `DATA_DIR` | `.data` | `memory` for a disposable server that keeps nothing |
| `ALLOWED_ORIGINS` | `*` | Comma-separated; set it to your app's origin in production |

The app finds the API through `EXPO_PUBLIC_API_URL`, inlined at build time:

```bash
EXPO_PUBLIC_API_URL=https://api.example.com npm run web:build
```

Left unset it points at `http://localhost:4000` — and at `http://10.0.2.2:4000`
on Android, which is how the emulator reaches the host machine.

## Endpoints

All bodies are JSON. Authenticated routes take `Authorization: Bearer <token>`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness. The only unauthenticated route besides the two below. |
| `POST` | `/auth/register` | `{ email, password, displayName?, device? }` → `{ user, token, expiresAt }` |
| `POST` | `/auth/login` | `{ email, password, device? }` → `{ user, token, expiresAt }` |
| `GET` | `/auth/me` | The current user and session |
| `POST` | `/auth/logout` | Ends this session |
| `POST` | `/auth/logout-others` | Ends every other session → `{ revoked }` |
| `GET` | `/auth/sessions` | Signed-in devices, with the current one marked |
| `DELETE` | `/auth/sessions/:id` | Revokes one device |
| `GET` | `/state` | `{ revision, updatedAt, device, values }` |
| `PUT` | `/state` | `{ baseRevision, device, values }` → `{ revision, updatedAt }`, or 409 |
| `GET` | `/study-sessions` | Every recorded sitting |
| `POST` | `/study-sessions` | One sitting or `{ sessions: [...] }`; merged by id |

Errors are `{ error, message }` with a code from `AuthErrorCode` in
`@language-srs/core`. The message is written for a learner and the app shows it
as-is, so a rule is never enforced in one place and described differently in the
other.

## The decisions worth knowing about

**Passwords are scrypt, from the standard library.** bcrypt and argon2 are native
add-ons — a compiler on the host and a rebuild on every Node upgrade — in
exchange for a difference that does not matter at this scale. The cost parameters
are stored *inside* each hash, so raising them later leaves existing accounts
working instead of locking everyone out.

**Sessions are opaque tokens, not JWTs.** A JWT cannot be taken back before it
expires, so "sign out this device" becomes either a lie or a revocation list —
which is the per-request database lookup that JWTs are adopted to avoid. Since a
device list with revocation is exactly what this API is for, it uses a credential
that can actually be revoked. Tokens are stored as SHA-256 hashes, so a leaked
database is not a set of working logins.

**Sign-in tells you nothing about who has an account.** An unknown email and a
wrong password produce the same status, the same body, and — because the unknown
path still verifies against a decoy hash of the same cost — roughly the same
timing. Sign-*up* does say when an email is taken, because hiding it only moves
the discovery to the sign-in form and turns a clear message into a support
ticket.

**Failed sign-ins are rate limited per email**, in memory. Losing the counter on
restart costs an attacker a restart's worth of guesses; persisting it would cost
a locked-out learner their evening.

**State is opaque to the server.** It stores the engine's own storage keys as
strings. Teaching the API about cards and FSRS stability would mean every change
to the domain needing a matching migration in a service that has no opinion about
any of it.

## What sync guarantees, and what it does not

- **State is last-writer-wins at whole-account granularity.** Writes carry the
  revision they were based on; a stale write is refused with 409 and the current
  state, so a device that has fallen behind is told rather than allowed to
  overwrite. But two devices used offline over the same period will not merge —
  the one that syncs second wins.
- **Sittings always merge.** They are append-only and immutable once finished, so
  a union by id is correct, and losing an evening somebody actually studied is
  the one outcome worth extra code to prevent.
- **A device joining an account adopts it.** It does not merge its local cards
  in, because there is no honest way to merge two FSRS histories for the same
  card — one of them has to be the truth about when you last saw that word. What
  you studied signed out stays in the signed-out namespace and is still there
  when you sign out again.

## Storage

`JsonFileServerStore` holds everything in memory and rewrites one file after each
change, atomically (temp file, then rename) and serialised through a single
promise chain. That is the right trade at this size and the wrong one the moment
there are two processes, because there is no locking between them.

`ServerStore` is the seam. A Postgres implementation is a file plus one line in
`index.ts`; nothing above it knows which is in use, which is why the whole API
test suite runs against the in-memory one.

## Running it somewhere real

Three things before this faces the internet:

1. **Terminate TLS in front of it.** Tokens are bearer credentials, and this
   process speaks plain HTTP.
2. **Set `ALLOWED_ORIGINS`** to your app's origin. `*` is defensible for a bearer
   API that never uses cookies, but defence in depth costs one variable.
3. **Back up `DATA_DIR`.** It is one JSON file, and it is the accounts.

The service has no runtime dependencies — `node:http`, `node:crypto`,
`node:fs` and `@language-srs/core`. `tsx` is a development dependency used to run
TypeScript directly; a production image can compile ahead of time instead.
