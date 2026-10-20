# Baraza

**A real-time forum API in GraphQL** (users, posts, comments), built with NestJS to show three advanced techniques working together:

1. **Code-first GraphQL**: the schema is generated from decorated TypeScript classes, never written by hand.
2. **The N+1 problem, measured and solved** with DataLoader: a nested query goes from **24 SQL queries to 3**.
3. **Real-time subscriptions** over WebSocket (`graphql-ws`), with JWT auth on both HTTP and WebSocket.

There is no UI, on purpose. The deliverable is the API itself: a typed, self-documenting contract (`schema.gql`) that any client (web, mobile, script) can consume, and that you can explore and test with nothing more than `curl`, `wscat` or Apollo Sandbox. Everything below is copy-paste runnable.

> *Baraza* means a public meeting place for discussion in Swahili.

---

## Contents

- [Stack](#stack)
- [What this project demonstrates](#what-this-project-demonstrates)
- [API reference](#api-reference)
- [Getting started](#getting-started)
- [How to test it](#how-to-test-it)
- [Security notes](#security-notes)
- [Known limitations and choices](#known-limitations-and-choices)
- [Project layout](#project-layout)

---

## Stack

Versions are the ones installed from `apps/api/package.json` / `pnpm-lock.yaml`.

| Concern | Package | Version |
|---|---|---|
| Framework | `@nestjs/core`, `@nestjs/common`, `@nestjs/platform-express` | 11.2.7 |
| GraphQL (code-first) | `@nestjs/graphql` + `@nestjs/apollo` | 13.4.5 |
| GraphQL server | `@apollo/server` (+ `@as-integrations/express5` 1.1.2) | 5.5.1 |
| GraphQL runtime | `graphql` | 16.14.2 |
| Subscriptions transport | `graphql-ws` (protocol `graphql-transport-ws`) | 6.2.1 |
| PubSub | `graphql-subscriptions` (in memory) | 3.0.0 |
| ORM | `typeorm` + `@nestjs/typeorm` | 1.1.2 / 11.0.3 |
| Database | PostgreSQL (Docker image) | 16 |
| Batching | `dataloader` | 2.2.3 |
| Auth | `@nestjs/jwt` (HS256) | 11.0.2 |
| Password hashing | `argon2` (argon2id) | 0.45.1 |
| Config | `@nestjs/config` | 4.0.4 |
| Language / tests | TypeScript 5.9.3, Jest 30.5.2 | |

Why these exact versions: Apollo Server 5 requires `graphql@^16.11` (graphql 17 is not supported), and `@nestjs/graphql`/`@nestjs/apollo` 13.x is the line that targets NestJS 11 and Apollo Server 5. `graphql-ws` and `ws` are pinned to the versions `@nestjs/graphql` ships with, so only one copy is installed.

---

## What this project demonstrates

### 1. Code-first GraphQL with field-level control

The schema ([`apps/api/src/schema.gql`](apps/api/src/schema.gql)) is **generated at startup** from classes that are both TypeORM entities and GraphQL object types. Only properties decorated with `@Field()` reach the schema:

```ts
@ObjectType()
@Entity()
export class User {
  @Field(() => ID) @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ unique: true }) email: string;   // no @Field: never in the schema
  @Column() passwordHash: string;            // no @Field: never in the schema

  @Field() @Column() username: string;
  @Field() @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}
```

The public `User` type is therefore `{ id, username, createdAt }`. Asking for `email` or `passwordHash` is a validation error, and an e2e test asserts it.

Relations (`Post.author`, `Post.comments`, `Post.commentCount`, `Comment.author`) are not columns exposed directly. They are `@ResolveField`s, which is exactly where the N+1 problem appears.

### 2. The N+1 problem, and how DataLoader solves it

This query looks innocent:

```graphql
query {
  posts { title author { username } comments { body author { username } } }
}
```

With naive field resolvers (one database call per parent), the seed data (5 posts, 13 comments, 3 users) produced **24 SQL queries**, counted in the TypeORM query log:

| SQL | Naive | With DataLoader |
|---|---|---|
| `SELECT … FROM post` | 1 | 1 |
| `SELECT … FROM user` (post authors) | 5, one per post | **1**, `WHERE id IN (…)` |
| `SELECT … FROM comment` | 5, one per post | **1**, `WHERE "postId" IN (…)` |
| `SELECT … FROM user` (comment authors) | 13, one per comment | **0**, served from cache |
| **Total** | **24** (1 + N + N + C) | **3** |

Adding `commentCount` to the query adds exactly **one** query (`SELECT "postId", COUNT(*) … GROUP BY "postId"`), not one per post. The figures were measured with the same seed before and after the change, and re-checked on the current code.

How it gets to 3 ([`apps/api/src/loaders/loaders.service.ts`](apps/api/src/loaders/loaders.service.ts)):

- **Batching.** Every `load(id)` call made in the same tick is collected, and then **one** query fetches them all with `IN (…)`. Three loaders exist: `usersById`, `commentsByPostId` (grouped back per post, `[]` when a post has none) and `commentCountByPostId` (`0` when absent). Each one returns results **aligned with the order of the requested keys**, which is the DataLoader contract. Unit tests cover the alignment.
- **Deduplication and cache.** 18 author lookups target only 3 distinct users. The first batch loads all 3, so when GraphQL resolves the comment authors one level deeper, every key is already cached and **no query is sent**. With a commenter who never posted, you would see one more small `IN (…)` query for the missing ids only, so 4 in total.
- **Scope: one set of loaders per request.** A loader cache must never be shared between requests, otherwise users would see each other's data and the cache would never be cleared. Loaders are built in the GraphQL `context` factory, so they are new for every HTTP request. Resolvers stay singletons, unlike the `Scope.REQUEST` approach, which would re-instantiate the whole provider chain on every request.
- **The WebSocket case.** With `graphql-ws`, the context is created once per *operation*, and graphql-js reuses it for *every event* of a long-lived subscription. Cached loaders would serve stale rows for the life of the subscription. WebSocket operations therefore get loaders created with `cache: false`: batching still works, nothing is kept between events. An e2e test renames a user between two events and checks that the second event shows the new name. The test fails if caching is turned back on.

To see this yourself, run the query below and watch the API terminal (see [How to test it](#how-to-test-it)).

### 3. Real-time subscriptions

`commentAdded(postId: ID!)` pushes every new comment on that post to subscribers, over WebSocket, on the same `/graphql` endpoint:

- **Transport:** `graphql-ws` (protocol `graphql-transport-ws`). The deprecated `subscriptions-transport-ws` protocol is disabled.
- **Filtering:** the server only delivers an event when `payload.commentAdded.postId === variables.postId`. A subscriber to post A receives nothing for post B, and e2e tests check this.
- **Ordering:** `addComment` **persists first, then publishes**, so a subscriber can never receive a comment that does not exist in the database.
- **Swappable PubSub:** the PubSub is provided behind an injection token (`PUB_SUB`) and typed as `PubSubEngine`. Switching to Redis only means changing that one provider ([`apps/api/src/pubsub/pubsub.module.ts`](apps/api/src/pubsub/pubsub.module.ts)).

### 4. Authentication on HTTP and WebSocket

- **The identity always comes from the token, never from the input.** `CreatePostInput` is `{ title, body }` and `AddCommentInput` is `{ postId, body }`. Neither has an `authorId` field, so a client cannot write as someone else. Sending `authorId` anyway is rejected by GraphQL validation (tested). The author is `@CurrentUser()`, resolved from the JWT.
- **HTTP:** `Authorization: Bearer <jwt>`. `GqlAuthGuard` reads the request from the GraphQL context, verifies the token and attaches the user.
- **WebSocket:** browsers cannot set headers on a WebSocket, so the token goes in `connectionParams` of the `connection_init` message: `{ "authorization": "Bearer <jwt>" }`. It is verified **once, at the handshake**.
- **One verification path for both transports:** `AuthService.verifyBearer`. It pins the algorithm to HS256 and rejects expired tokens and tokens pointing to a deleted user. No Passport: a small guard is easier to share between the two transports.
- **Passwords:** hashed with **argon2id**. Login is **generic and constant-time**; see [Security notes](#security-notes).

---

## API reference

Derived from the generated [`schema.gql`](apps/api/src/schema.gql).

### Types

```graphql
type User    { id: ID!  username: String!  createdAt: DateTime! }
type Post    { id: ID!  title: String!  body: String!  createdAt: DateTime!
               author: User!  comments: [Comment!]!  commentCount: Int! }
type Comment { id: ID!  body: String!  createdAt: DateTime!  author: User! }
type AuthPayload { token: String!  user: User! }
```

### Operations

| Operation | Signature | What it does | Token |
|---|---|---|---|
| Query | `posts(limit: Int): [Post!]!` | Newest posts first. `limit` defaults to 20, clamped to 1–100. | No |
| Query | `post(id: ID!): Post` | One post, or `null`. | No |
| Query | `me: User!` | The user behind the token. | **Yes** |
| Mutation | `register(input: { email, username, password }): AuthPayload!` | Creates an account and returns a token. | No |
| Mutation | `login(input: { email, password }): AuthPayload!` | Returns a token. | No |
| Mutation | `createPost(input: { title, body }): Post!` | Creates a post **authored by the token's user**. | **Yes** |
| Mutation | `addComment(input: { postId, body }): Comment!` | Adds a comment **authored by the token's user**, then publishes it. | **Yes** |
| Subscription | `commentAdded(postId: ID!): Comment!` | Live feed of new comments on one post. | No (read is public) |

Input rules enforced by the server:

- **`register`:**
  - the email is trimmed and lowercased, and must be unique;
  - `username` is 3–30 characters among `A-Z a-z 0-9 _ -`;
  - the password is 8–128 characters.
- **`createPost`:**
  - `title` is trimmed, cannot be empty and is limited to 200 characters;
  - `body` is trimmed, cannot be empty and is limited to 10,000 characters (twice the comment limit: posts are the long-form content).
- **`addComment`:**
  - `body` is trimmed, cannot be empty and is limited to 5000 characters;
  - `postId` must be an existing post.

Authentication errors come back as GraphQL errors with `extensions.code: "UNAUTHENTICATED"` and the message `Authentication required`, or `Invalid credentials` for `login`.

---

## Getting started

### Prerequisites

- **Node.js**: `^20.19 || ^22.13 || >=24.11`, the strictest requirement in the dependency tree (TypeORM 1.1). Developed on Node 25.
- **pnpm**: developed with 11.5.2. The workspace file uses `allowBuilds`, a recent pnpm setting.
- **Docker**, for PostgreSQL.

### Install and run

```bash
# 1. Install dependencies (from the repo root)
pnpm install

# 2. Start PostgreSQL 16 (exposed on localhost:5434)
docker compose up -d

# 3. Configure the API
cp apps/api/.env.example apps/api/.env
# then set a real JWT_SECRET (at least 32 characters; the API refuses to start otherwise):
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

# 4. Start the API in watch mode (creates the tables in dev, see DATABASE_SYNCHRONIZE)
pnpm dev:api

# 5. In another terminal: load sample data
pnpm seed
```

The API listens on **http://localhost:3000/graphql**, for HTTP and WebSocket alike. In development, opening that URL in a browser shows **Apollo Sandbox**, an interactive explorer with autocompletion and subscription support.

### Environment variables (`apps/api/.env`)

| Variable | Example | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgres://baraza:baraza@localhost:5434/baraza` | Matches `docker-compose.yml`. |
| `DATABASE_SSL` | `false` | `true` for managed Postgres providers that require SSL. |
| `DATABASE_SYNCHRONIZE` | `true` | Dev only: create tables from the entities. **Ignored when `NODE_ENV=production`.** |
| `PORT` | `3000` | HTTP and WebSocket port. |
| `JWT_SECRET` | *(generated)* | HS256 signing secret, at least 32 characters. |
| `JWT_EXPIRES_IN` | `1h` | Token lifetime (`15m`, `1h`, `7d`…). |

### Seed data

`pnpm seed` **wipes** the three tables and inserts 3 users, 5 posts and 13 comments. All seed users share the password `password123`:

| Email | Username |
|---|---|
| `amani@example.com` | `amani` |
| `baraka@example.com` | `baraka` |
| `chausiku@example.com` | `chausiku` |

### Automated tests

```bash
pnpm --filter api test        # unit tests (DataLoader batching, alignment, per-request scope)
pnpm --filter api test:e2e    # e2e: auth, subscriptions, filtering, stale-cache check
pnpm --filter api lint
pnpm --filter api typecheck
```

The e2e tests boot the full app on a random port against the Postgres from `docker compose` (it must be running). They create their own users and posts and delete them afterwards.

---

## How to test it

All examples use `curl` and [`wscat`](https://github.com/websockets/wscat) (`npm i -g wscat`, or prefix the commands with `npx`). The same operations can be run in Apollo Sandbox at http://localhost:3000/graphql.

### 1. Read posts and watch DataLoader batch

```bash
curl -s http://localhost:3000/graphql \
  -H 'content-type: application/json' \
  -d '{"query":"{ posts { id title author { username } comments { body author { username } } } }"}'
```

Now look at the terminal running `pnpm dev:api`. In development, every SQL query is logged; parameters are hidden on purpose, see [Security notes](#security-notes). For this request you should see **three** queries:

```text
query: SELECT … FROM "post" "Post" ORDER BY "Post"."createdAt" DESC LIMIT 20
query: SELECT … FROM "user" "User" WHERE (("User"."id" IN ($1, $2, $3)))
query: SELECT … FROM "comment" "Comment" WHERE (("Comment"."postId" IN ($1, $2, $3, $4, $5))) ORDER BY "Comment"."createdAt" ASC
```

Add `commentCount` to the query and exactly one `GROUP BY` query appears. Keep a post `id` from the response for the next steps.

### 2. Get a token

Log in as a seed user:

```bash
curl -s http://localhost:3000/graphql \
  -H 'content-type: application/json' \
  -d '{"query":"mutation { login(input: { email: \"amani@example.com\", password: \"password123\" }) { token user { id username } } }"}'
```

Or create your own account:

```bash
curl -s http://localhost:3000/graphql \
  -H 'content-type: application/json' \
  -d '{"query":"mutation { register(input: { email: \"you@example.com\", username: \"you\", password: \"a-long-password\" }) { token user { id username } } }"}'
```

Copy the `token`, then:

```bash
export TOKEN='<paste the token here>'
export POST_ID='<paste a post id here>'
```

Check who you are:

```bash
curl -s http://localhost:3000/graphql \
  -H 'content-type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"query":"{ me { id username } }"}'
```

### 3. Write: create a post, add a comment (authenticated)

Create a post:

```bash
curl -s http://localhost:3000/graphql \
  -H 'content-type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"query":"mutation { createPost(input: { title: \"My first post\", body: \"Hello Baraza\" }) { id title author { username } } }"}'
```

Add a comment (on the post from step 1, or the one you just created):

```bash
curl -s http://localhost:3000/graphql \
  -H 'content-type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"query\":\"mutation { addComment(input: { postId: \\\"$POST_ID\\\", body: \\\"Hello from curl\\\" }) { id body author { username } } }\"}"
```

In both cases the author in the response is the token's user. Run either command without the `Authorization` header and you get `Authentication required` (`UNAUTHENTICATED`), and nothing is written.

### 4. Watch comments arrive in real time

**Terminal A**: open a WebSocket with the `graphql-ws` subprotocol:

```bash
wscat -c ws://localhost:3000/graphql -s graphql-transport-ws
```

Then type these two messages, one after the other. Replace `<POST_ID>` in the second one.

```json
{"type":"connection_init","payload":{}}
```

```json
{"id":"1","type":"subscribe","payload":{"query":"subscription { commentAdded(postId: \"<POST_ID>\") { id body author { username } } }"}}
```

The server answers the first message with `{"type":"connection_ack"}`. No token is needed to subscribe. To connect as a user, send `{"type":"connection_init","payload":{"authorization":"Bearer <TOKEN>"}}` instead. A token that is present but invalid closes the connection with code `4403`.

**Terminal B**: run the `addComment` command from step 3. Terminal A immediately prints:

```text
< {"id":"1","type":"next","payload":{"data":{"commentAdded":{"id":"…","body":"Hello from curl","author":{"username":"amani"}}}}}
```

Add a comment on **another** post: terminal A receives nothing, because events are filtered by `postId`.

---

## Security notes

The backend-specific notes also live in [`apps/api/README.md`](apps/api/README.md#security).

- **Sensitive fields stay out of the schema.** `email` and `passwordHash` have no `@Field()`, so no query can select them. An e2e test asserts it.
- **No impersonation.** No create input has an author field. The author is always the authenticated user from the JWT.
- **Passwords:** argon2id with the library defaults (64 MiB memory, 3 iterations, parallelism 4). The parameters are stored in the hash, so they can be raised later.
- **JWT:** HS256 is pinned at verification time, so a token cannot pick its own algorithm. The secret comes from the environment and must be at least 32 characters, otherwise the API refuses to start. The expiry is configurable.
- **Login does not help account enumeration.** An unknown email and a wrong password return the same `Invalid credentials` and take the same time: a dummy argon2 hash is verified when the email does not exist.
- **Deliberate trade-off on `register`.** `register` answers `Email already registered` when an email is taken. This is a conscious UX choice, and it does reveal whether an email has an account. Closing enumeration completely would require an email confirmation flow (`register` always answers "check your inbox"), which is out of scope here.
- **No secrets in logs.** The TypeORM logger prints SQL text but **never bound parameters**, which would otherwise include password hashes and emails (for example `INSERT INTO "user"`). Tokens are never logged.
- **Stack traces in error responses.** In development, GraphQL errors include `extensions.stacktrace`. Apollo Server removes them only when `NODE_ENV` is `production` (or `test`). This project does not set `includeStacktraceInErrorResponses: false` explicitly. **Before any production use, run with `NODE_ENV=production` or set that option explicitly.** `NODE_ENV=production` also turns off introspection, Apollo Sandbox, schema synchronization and SQL query logging.

---

## Known limitations and choices

- **Not deployed.** This is a learning and portfolio project, meant to be run and tested locally (see above).
- **No migrations yet.** Tables are created by TypeORM `synchronize`, which is enabled only in development through `DATABASE_SYNCHRONIZE` and always off in production. A production deployment would first need migrations.
- **Read is public, write is authenticated.** `posts`, `post` and the `commentAdded` subscription need no token, consistent with each other. `createPost`, `addComment` and `me` require one.
- **The WebSocket token is only checked at the handshake.** An open subscription keeps receiving events after the token expires. Closing the socket at the token's `exp` would fix it.
- **In-memory PubSub.** Events only reach subscribers connected to the **same** API instance. Running several instances requires a shared PubSub such as Redis, which is a one-provider swap thanks to the `PUB_SUB` token.
- **The e2e tests use the development database.** They clean up after themselves, but there is no separate test database.

---

## Project layout

```text
.
├── docker-compose.yml          # PostgreSQL 16 on localhost:5434
├── package.json                # root scripts: dev:api, seed
├── pnpm-workspace.yaml
└── apps/api                    # NestJS application
    ├── src
    │   ├── schema.gql          # generated, do not edit
    │   ├── app.module.ts       # GraphQL, TypeORM, WebSocket handshake, per-request context
    │   ├── auth/               # register/login/me, GqlAuthGuard, @CurrentUser, argon2
    │   ├── users/  posts/  comments/   # entities (= object types), services, resolvers
    │   ├── loaders/            # DataLoader factory (usersById, commentsByPostId, commentCountByPostId)
    │   ├── pubsub/             # PUB_SUB provider (in memory, swappable)
    │   ├── redacted-sql.logger.ts
    │   └── seed.ts
    └── test/                   # e2e: auth, subscriptions
```
