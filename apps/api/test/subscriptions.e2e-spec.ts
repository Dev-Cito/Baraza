import { INestApplication } from '@nestjs/common';
import type { EventEmitter } from 'node:events';
import { Client } from 'graphql-ws';
import { PubSub } from 'graphql-subscriptions';
import { DataSource } from 'typeorm';
import { Post } from './../src/posts/post.entity';
import { PUB_SUB } from './../src/pubsub/pubsub.module';
import { User } from './../src/users/user.entity';
import {
  gql,
  registerAndLogin,
  startApp,
  TestUser,
  waitFor,
  wsClient,
} from './helpers';

interface CommentEvent {
  id: string;
  body: string;
  createdAt: string;
  author: { username: string };
}

const SUBSCRIPTION = /* GraphQL */ `
  subscription ($postId: ID!) {
    commentAdded(postId: $postId) {
      id
      body
      createdAt
      author {
        username
      }
    }
  }
`;

const ADD_COMMENT = /* GraphQL */ `
  mutation ($input: AddCommentInput!) {
    addComment(input: $input) {
      id
      body
    }
  }
`;

describe('commentAdded subscription (e2e)', () => {
  let app: INestApplication;
  let host: string;
  let dataSource: DataSource;
  let user: TestUser;
  let postA: Post;
  let postB: Post;
  const clients: Client[] = [];

  beforeAll(async () => {
    ({ app, host } = await startApp());
    dataSource = app.get(DataSource);
    user = await registerAndLogin(host, 'subscriber-test');
    const posts = dataSource.getRepository(Post);
    postA = await posts.save({ title: 'A', body: 'A', authorId: user.id });
    postB = await posts.save({ title: 'B', body: 'B', authorId: user.id });
  });

  afterAll(async () => {
    for (const client of clients) void client.dispose();
    // Cascades to the test posts and comments.
    if (user) await dataSource.getRepository(User).delete(user.id);
    await app.close();
  });

  // Each subscriber gets its own WebSocket connection.
  function subscribe(
    postId: string,
    token?: string,
    connectionParams?: Record<string, unknown>,
  ) {
    const client = wsClient(host, token, connectionParams);
    clients.push(client);
    const events: CommentEvent[] = [];
    const errors: unknown[] = [];
    client.subscribe<{ commentAdded: CommentEvent }>(
      { query: SUBSCRIPTION, variables: { postId } },
      {
        next: (result) => {
          if (result.errors) errors.push(...result.errors);
          if (result.data) events.push(result.data.commentAdded);
        },
        error: (err) => errors.push(err),
        complete: () => undefined,
      },
    );
    return { events, errors };
  }

  // graphql-ws has no "subscribed" ack, so wait until the server has actually
  // attached the subscriptions' listeners to the in-memory PubSub.
  // Subscribers from earlier tests stay connected until afterAll, so callers
  // wait for a count relative to a baseline.
  function listenerCount(): number {
    const pubSub: PubSub = app.get(PUB_SUB);
    const { ee } = pubSub as unknown as { ee: EventEmitter };
    return ee.listenerCount('commentAdded');
  }

  async function waitForListeners(count: number) {
    await waitFor(() => listenerCount() >= count);
  }

  async function addComment(postId: string, body: string) {
    const res = await gql<{ addComment: { id: string; body: string } }>(
      host,
      ADD_COMMENT,
      { input: { postId, body } },
      user.token,
    );
    expect(res.errors).toBeUndefined();
    return res.data!.addComment;
  }

  it('pushes new comments live, only to subscribers of that post, with fresh author data', async () => {
    const before = listenerCount();
    const subA = subscribe(postA.id, user.token);
    const subB = subscribe(postB.id, user.token);
    await waitForListeners(before + 2);

    // 1. Comment on B: B's subscriber gets it, A's gets nothing.
    const onB = await addComment(postB.id, 'comment on B');
    await waitFor(() => subB.events.length === 1);
    expect(subB.events[0]).toMatchObject({ id: onB.id, body: 'comment on B' });

    // 2. Comment on A: A's subscriber gets it (author resolved via loaders).
    const onA = await addComment(postA.id, 'comment on A');
    await waitFor(() => subA.events.length === 1);
    expect(subA.events[0]).toMatchObject({
      id: onA.id,
      body: 'comment on A',
      author: { username: 'subscriber-test' },
    });
    // Published events are delivered in order, so if B's comment had leaked
    // to A's subscriber it would be in A's events before this one.
    expect(subA.events).toHaveLength(1);
    expect(subB.events).toHaveLength(1);

    // 3. Same long-lived subscription, author renamed in between: the next
    // event must show the new name, not a value cached by the first event.
    await dataSource
      .getRepository(User)
      .update(user.id, { username: 'renamed-test' });
    await addComment(postA.id, 'after rename');
    await waitFor(() => subA.events.length === 2);
    expect(subA.events[1].author.username).toBe('renamed-test');
    expect(subB.events).toHaveLength(1);
    expect([...subA.errors, ...subB.errors]).toEqual([]);
  });

  it('lets anonymous clients subscribe and receive live events, filtered by post', async () => {
    const before = listenerCount();
    // No token at all, and an empty authorization value: both are anonymous.
    const anonA = subscribe(postA.id);
    const anonB = subscribe(postB.id, undefined, { authorization: '' });
    await waitForListeners(before + 2);

    // Writing still needs a token: the comments come from the logged-in user.
    const onB = await addComment(postB.id, 'anon test on B');
    await waitFor(() => anonB.events.length === 1);
    expect(anonB.events[0]).toMatchObject({
      id: onB.id,
      body: 'anon test on B',
    });

    const onA = await addComment(postA.id, 'anon test on A');
    await waitFor(() => anonA.events.length === 1);
    expect(anonA.events[0]).toMatchObject({
      id: onA.id,
      body: 'anon test on A',
    });
    // Resolved through the loaders on an anonymous connection too. Read the
    // current name from the database: another test may have renamed the user.
    const author = await dataSource
      .getRepository(User)
      .findOneByOrFail({ id: user.id });
    expect(anonA.events[0].author.username).toBe(author.username);
    // B's comment never reached A's subscriber (it would have arrived first).
    expect(anonA.events).toHaveLength(1);
    expect(anonB.events).toHaveLength(1);
    expect([...anonA.errors, ...anonB.errors]).toEqual([]);
  });

  it('closes the connection at the handshake when the token is invalid', async () => {
    const forged = subscribe(postA.id, 'not-a-valid-jwt');
    await waitFor(() => forged.errors.length > 0);
    // graphql-ws reports the close event: 4403 Forbidden from onConnect.
    expect(forged.errors[0]).toMatchObject({ code: 4403 });
    expect(forged.events).toEqual([]);
  });
});
