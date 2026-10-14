# Where the logic lives

Mon is one backend and three interfaces. This file records why, and what the open
decisions are.

## The shape

```
proto/mon/v1/mon.proto     the contract — language-neutral, versioned, linted
packages/core/             the domain: FSRS, curricula, queue, answers, journey
apps/server/               the backend: core behind an API
apps/web/                  an interface
apps/mobile/               an interface (Expo today; SwiftUI + Compose next)
```

The clients render. They own navigation, motion, a local cache and the queue of
unsent gradings — and nothing else. A client that computes an interval has
reintroduced the problem this arrangement exists to prevent.

## gRPC, and the browser problem

**A browser cannot speak gRPC.** HTTP/2 trailers are not exposed to JavaScript,
so gRPC-Web needs either a translating proxy (Envoy) in front of the server, or a
server that speaks gRPC-Web natively.

For a product with a web client, running an Envoy sidecar to translate for one
app is real operational cost — a second process to deploy, configure, monitor and
upgrade — for nothing the web app can feel.

**[Connect](https://connectrpc.com) is the better fit.** It serves the same
`.proto` over gRPC, gRPC-Web *and* plain HTTP/JSON from one process, no proxy. The
phones get binary gRPC over HTTP/2; the browser calls it directly; `curl` still
works, which matters more during debugging than it sounds. Implementations exist
for Go, Rust (via `connect-rs`), Node, Swift and Kotlin.

The `.proto` is identical either way, which is why it was written first.

## Is the backend worth rewriting in Rust or Go?

Probably — but for reasons worth naming correctly, and not yet.

**The reason it is tempting is not the one usually given.** The domain work per
request is microseconds: building a queue is sorting a few hundred cards, grading
is a dozen floating-point operations. Node is not the bottleneck at any plausible
user count, and a rewrite justified by "efficiency" alone would be the Vite
question again — a migration that measures well in theory and changes nothing a
user feels.

**The reasons that do hold up:**

- **Deployment shape.** A Rust or Go binary is a single static artifact with no
  runtime to install, a few megabytes, starting in milliseconds. That is a real
  operational difference for a sidecar, a Raspberry Pi, or a scale-to-zero host.
- **One implementation, everywhere, including offline.** This is the strong
  argument, and it favours **Rust specifically**. Rust compiles to WebAssembly and
  exposes a C ABI for Swift and Kotlin. The *same* scheduler could then run on the
  server, in the browser for offline study, and natively inside both phone apps —
  one implementation, one test suite, no drift. That is a better answer than
  today's, where the web app runs a TypeScript copy locally and the server runs
  the same source, but a native phone app would have to call out over a network to
  schedule anything.
- Go gets the deployment benefit but not the second one: its WASM output is large
  and its mobile FFI story is poor. **If the backend moves, Rust is the one that
  pays twice.**

**The cost is the part to be honest about.** `packages/core` is not a thin API
layer. It is FSRS-4.5 with exam-date pressure, four exam curricula as data, the
queue builder with its weighted interleave, distractor generation, the deck,
triage, the journey ladders, and 330 tests pinning the behaviour. A port is weeks,
and a *partial* port is worse than none: a scheduler that is subtly wrong produces
intervals nobody notices are wrong until a learner's retention quietly degrades.

### Recommended order

1. **Contract first.** Done — `proto/mon/v1/mon.proto`, linted, compiling.
2. **Serve it from the existing TypeScript backend** via Connect. Same core, same
   330 tests, no port. The native clients can be written against the real contract
   immediately rather than waiting for a rewrite.
3. **Build the SwiftUI and Compose clients** against it. This is where the
   remaining product work actually is.
4. **Port the core to Rust only if step 2 or 3 shows a reason** — a deployment
   constraint, or wanting offline scheduling inside the native apps without a
   TypeScript runtime. Port it behind the same `.proto`, with the existing tests
   translated first and run against both implementations until they agree.

Step 4 is genuinely worth doing for the WASM-plus-FFI story. It is not worth doing
before there is a native client to benefit from it, and it is not worth doing
because Node is slow, because Node is not the slow part.

## What is not negotiable whichever way it goes

- The scheduler exists **once**. Three ports of FSRS is three chances for a
  learner's phone and laptop to disagree about when a word is due, silently.
- Grading stays a **batch with timestamps**, so studying works with no signal.
- Every number a client shows is one the learner could verify elsewhere in the
  app. That rule survived four refactors; it survives this one.
