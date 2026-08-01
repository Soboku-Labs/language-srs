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
| `VOCAB_DIR` | `data/vocab` | The word lists to serve; missing is survivable |
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
| `GET` | `/vocabulary` | Manifest: dataset version, level sizes, sources. **No auth** |
| `GET` | `/vocabulary/:levelId` | One level's words. **No auth**, immutable, ETagged |
| `GET` | `/vocabulary-levels?ids=a,b` | Up to twelve levels at once. **No auth** |

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

## The word lists

The three vocabulary routes are the only unauthenticated ones besides `/health`,
and the only ones that may be cached. Both follow from what they serve: a
published word list is public, identical for everybody, and changes when a
scraper runs and a commit lands rather than while somebody is studying.

- **Unauthenticated**, because requiring a token to read a syllabus would mean a
  learner cannot see what they would be studying until they have an account.
- **`public, max-age=604800, immutable`**, with a strong ETag. The version in the
  tag is a SHA-256 of the dataset files, so rebuilding them invalidates every
  cached copy on every device without anybody remembering to bump a number — and
  a device that already holds HSK 1 gets a 304 rather than 70KB.
- **Held in memory** by the server: 1.7MB of read-only data that every client
  wants and nothing ever writes is the one shape where a cache is simply correct.

This is what took the app bundle from 4.1MB to 2.2MB. The words used to be
compiled in — every level of every language, shipped to a phone on install and
again on every update, so that somebody could study fifteen a day. The client
now fetches the levels in scope, caches them keyed by dataset version, and falls
back to a bundled starter deck when there is no server to ask.

A server with no `VOCAB_DIR` still runs: it serves accounts, answers the
vocabulary routes with 404, and clients keep the starter deck. Accounts and
syllabuses are separate jobs and one should not take the other down.

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

## Hosting it for free

`apps/server/Dockerfile` builds an image that runs anywhere that takes a
Dockerfile — Render, Fly, Koyeb, Railway. It is built from the repository root,
because the server imports `@language-srs/core` from the workspace:

```bash
docker build -f apps/server/Dockerfile -t language-srs-api .
docker run -p 4000:4000 -v srs-data:/data language-srs-api
```

Use a **named volume**, as above, rather than a bind mount to a directory you
own. The container runs as an unprivileged user, and a root-owned host directory
is not writable by it. The server refuses to start rather than accepting traffic
it cannot store anything for, so the failure is one line in the log rather than a
500 for whoever signs up first.

### Render, which is the shortest path

`render.yaml` in the repository root is a blueprint for Render's free web
service. It needs no credit card and gives a stable HTTPS URL, which matters: a
browser on an `https://` page will not call an `http://` API.

1. **New ▸ Blueprint** on Render, point it at this repository, apply.
2. Wait for the first build, then check `https://<name>.onrender.com/health`.
3. Put that base URL in the repository's Actions **variables** as `API_URL`
   (Settings ▸ Secrets and variables ▸ Actions ▸ Variables). The Pages workflow
   passes it to the build as `EXPO_PUBLIC_API_URL`. It is a variable rather than
   a secret because it is inlined into a public bundle — calling it a secret
   would be theatre.
4. Re-run the Pages workflow. Sign-in now works on the deployed site.

Set `ALLOWED_ORIGINS` to the origin serving the app —
`https://<owner>.github.io` for a Pages project site, the host with no path.

### What the free tier costs you

Both of these are properties of free hosting rather than of this service, and the
app is built to behave sensibly under them rather than to pretend otherwise:

- **The disk is ephemeral.** Accounts live in the container's filesystem, so a
  deploy or a restart starts them over. That is acceptable for trying accounts
  out and not acceptable for anything anybody would mind losing. Two ways out: a
  persistent disk on a paid plan, or a Postgres implementation of `ServerStore` —
  the interface exists for exactly this, and the whole API test suite runs
  against an in-memory implementation to prove it.
- **It sleeps when idle**, and the request that wakes it can take the better part
  of a minute. Sign-in and sign-up retry once with a long timeout and say
  "waking the server"; everything else fails quietly and syncs later, which is
  what the offline path already did.

### Anywhere else

Three things before this faces the internet on any host:

1. **Terminate TLS in front of it.** Tokens are bearer credentials, and this
   process speaks plain HTTP. Every platform above does this for you.
2. **Set `ALLOWED_ORIGINS`.** `*` is defensible for a bearer API that never uses
   cookies, but defence in depth costs one variable.
3. **Back up `DATA_DIR`.** It is one JSON file, and it is the accounts.

The service has no runtime dependencies — `node:http`, `node:crypto`,
`node:fs` and `@language-srs/core`. `tsx` is a development dependency used to run
TypeScript directly; a production image could compile ahead of time instead, at
the cost of no longer running exactly the source that was tested.
