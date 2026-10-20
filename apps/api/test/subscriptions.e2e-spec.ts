import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import type { EventEmitter } from 'node:events';
import type { AddressInfo } from 'node:net';
import { Client, createClient } from 'graphql-ws';
import { DataSource } from 'typeorm';
import WebSocket from 'ws';
import { AppModule } from './../src/app.module';
import { Post } from './../src/posts/post.entity';
import { PUB_SUB } from './../src/pubsub/pubsub.module';
import { User } from './../src/users/user.entity';

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

async function waitFor(condition: () => boolean, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('commentAdded subscription (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let baseUrl: string;
  let user: User;
  let postA: Post;
  let postB: Post;
  const clients: Client[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0);
    const { port } = app.getHttpServer().address() as AddressInfo;
    baseUrl = `localhost:${port}/graphql`;

    dataSource = app.get(DataSource);
    user = await dataSource.getRepository(User).save({
      email: `sub-test-${randomUUID()}@example.com`,
      passwordHash: 'not-a-real-hash',
      username: 'subscriber-test',
    });
    const posts = dataSource.getRepository(Post);
    postA = await posts.save({ title: 'A', body: 'A', authorId: user.id });
    postB = await posts.save({ title: 'B', body: 'B', authorId: user.id });
  });

  afterAll(async () => {
    await Promise.all(clients.map((client) => client.dispose()));
    // Cascades to the test posts and comments.
    if (user) await dataSource.getRepository(User).delete(user.id);
    await app.close();
  });

  // Each subscriber gets its own WebSocket connection.
  function subscribe(postId: string): CommentEvent[] {
    const client = createClient({
      url: `ws://${baseUrl}`,
      webSocketImpl: WebSocket,
    });
    clients.push(client);
    const events: CommentEvent[] = [];
    client.subscribe<{ commentAdded: CommentEvent }>(
      { query: SUBSCRIPTION, variables: { postId } },
      {
        next: (result) => {
          if (result.errors) throw new Error(JSON.stringify(result.errors));
          events.push(result.data!.commentAdded);
        },
        error: (err) => {
          throw err;
        },
        complete: () => undefined,
      },
    );
    return events;
  }

  // graphql-ws has no "subscribed" ack, so wait until the server has actually
  // attached the subscriptions' listeners to the in-memory PubSub.
  async function waitForListeners(count: number) {
    const { ee } = app.get(PUB_SUB) as unknown as { ee: EventEmitter };
    await waitFor(() => ee.listenerCount('commentAdded') >= count);
  }

  async function addComment(postId: string, body: string) {
    const res = await fetch(`http://${baseUrl}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: ADD_COMMENT,
        variables: { input: { postId, authorId: user.id, body } },
      }),
    });
    const json = (await res.json()) as {
      data?: { addComment: { id: string; body: string } };
      errors?: unknown;
    };
    expect(json.errors).toBeUndefined();
    return json.data!.addComment;
  }

  it('pushes new comments live, only to subscribers of that post, with fresh author data', async () => {
    const eventsA = subscribe(postA.id);
    const eventsB = subscribe(postB.id);
    await waitForListeners(2);

    // 1. Comment on B: B's subscriber gets it, A's gets nothing.
    const onB = await addComment(postB.id, 'comment on B');
    await waitFor(() => eventsB.length === 1);
    expect(eventsB[0]).toMatchObject({ id: onB.id, body: 'comment on B' });

    // 2. Comment on A: A's subscriber gets it (author resolved via loaders).
    const onA = await addComment(postA.id, 'comment on A');
    await waitFor(() => eventsA.length === 1);
    expect(eventsA[0]).toMatchObject({
      id: onA.id,
      body: 'comment on A',
      author: { username: 'subscriber-test' },
    });
    // Published events are delivered in order, so if B's comment had leaked
    // to A's subscriber it would be in eventsA before this one.
    expect(eventsA).toHaveLength(1);
    expect(eventsB).toHaveLength(1);

    // 3. Same long-lived subscription, author renamed in between: the next
    // event must show the new name, not a value cached by the first event.
    await dataSource
      .getRepository(User)
      .update(user.id, { username: 'renamed-test' });
    await addComment(postA.id, 'after rename');
    await waitFor(() => eventsA.length === 2);
    expect(eventsA[1].author.username).toBe('renamed-test');
    expect(eventsB).toHaveLength(1);
  });
});
