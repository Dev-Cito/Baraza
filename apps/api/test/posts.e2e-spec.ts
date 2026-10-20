import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { Post } from './../src/posts/post.entity';
import { User } from './../src/users/user.entity';
import { gql, registerAndLogin, startApp, TestUser } from './helpers';

const CREATE_POST = /* GraphQL */ `
  mutation ($input: CreatePostInput!) {
    createPost(input: $input) {
      id
      title
      body
      commentCount
      author {
        id
        username
      }
    }
  }
`;

interface CreatedPost {
  id: string;
  title: string;
  body: string;
  commentCount: number;
  author: { id: string; username: string };
}

describe('createPost (e2e)', () => {
  let app: INestApplication;
  let host: string;
  let dataSource: DataSource;
  let alice: TestUser;
  let bob: TestUser;

  beforeAll(async () => {
    ({ app, host } = await startApp());
    dataSource = app.get(DataSource);
    alice = await registerAndLogin(host, 'alice-posts');
    bob = await registerAndLogin(host, 'bob-posts');
  });

  afterAll(async () => {
    const ids = [alice?.id, bob?.id].filter(Boolean);
    // Cascades to their posts.
    if (ids.length) await dataSource.getRepository(User).delete(ids);
    await app.close();
  });

  // Titles are unique per call so database checks can't see other tests' rows.
  const uniqueTitle = (label: string) => `${label} ${randomUUID()}`;

  function createPost(input: Record<string, unknown>, token?: string) {
    return gql<{ createPost: CreatedPost }>(
      host,
      CREATE_POST,
      { input },
      token,
    );
  }

  const countByTitle = (title: string) =>
    dataSource.getRepository(Post).countBy({ title });

  it('fails without a token and creates nothing', async () => {
    const title = uniqueTitle('anonymous');
    const res = await createPost({ title, body: 'body' });

    expect(res.data).toBeNull();
    expect(res.errors?.[0]).toMatchObject({
      message: 'Authentication required',
      extensions: { code: 'UNAUTHENTICATED' },
    });
    expect(await countByTitle(title)).toBe(0);
  });

  it('creates the post with the token user as author', async () => {
    const title = uniqueTitle('by alice');
    const res = await createPost(
      { title: `  ${title}  `, body: '  Hello Baraza  ' },
      alice.token,
    );

    expect(res.errors).toBeUndefined();
    expect(res.data?.createPost).toMatchObject({
      title, // trimmed
      body: 'Hello Baraza',
      commentCount: 0,
      author: { id: alice.id, username: 'alice-posts' },
    });
    const stored = await dataSource
      .getRepository(Post)
      .findOneByOrFail({ id: res.data!.createPost.id });
    expect(stored.authorId).toBe(alice.id);
  });

  it('rejects an authorId in the input (no impersonation)', async () => {
    const title = uniqueTitle('as bob?');
    const res = await createPost(
      { title, body: 'body', authorId: bob.id },
      alice.token,
    );

    expect(res.errors?.[0].message).toContain(
      'Field "authorId" is not defined by type "CreatePostInput"',
    );
    expect(await countByTitle(title)).toBe(0);
  });

  it.each([
    [
      'empty title',
      { title: '   ', body: 'body' },
      'Post title cannot be empty',
    ],
    [
      'title over 200 characters',
      { title: 'x'.repeat(201), body: 'body' },
      'Post title cannot exceed 200 characters',
    ],
    [
      'empty body',
      { title: 'title', body: '   ' },
      'Post body cannot be empty',
    ],
    [
      'body over 10000 characters',
      { title: 'title', body: 'x'.repeat(10_001) },
      'Post body cannot exceed 10000 characters',
    ],
  ])('rejects %s', async (_case, input, message) => {
    const before = await dataSource
      .getRepository(Post)
      .countBy({ authorId: alice.id });

    const res = await createPost(input, alice.token);

    expect(res.data).toBeNull();
    expect(res.errors?.[0].message).toBe(message);
    expect(
      await dataSource.getRepository(Post).countBy({ authorId: alice.id }),
    ).toBe(before);
  });

  it('accepts a title and body at the maximum length', async () => {
    const res = await createPost(
      { title: 'x'.repeat(200), body: 'x'.repeat(10_000) },
      bob.token,
    );
    expect(res.errors).toBeUndefined();
    expect(res.data?.createPost.author.id).toBe(bob.id);
  });

  it('shows a new post in the posts query with its author resolved', async () => {
    const title = uniqueTitle('listed');
    const created = await createPost({ title, body: 'body' }, bob.token);
    expect(created.errors).toBeUndefined();

    const res = await gql<{
      posts: { id: string; title: string; author: { username: string } }[];
    }>(host, '{ posts(limit: 100) { id title author { username } } }');

    expect(res.errors).toBeUndefined();
    expect(
      res.data?.posts.find((p) => p.id === created.data!.createPost.id),
    ).toEqual({
      id: created.data!.createPost.id,
      title,
      author: { username: 'bob-posts' },
    });
  });
});
