import { INestApplication } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { Comment } from './../src/comments/comment.entity';
import { Post } from './../src/posts/post.entity';
import { User } from './../src/users/user.entity';
import { gql, registerAndLogin, startApp, TestUser } from './helpers';

const ME = /* GraphQL */ `
  query {
    me {
      id
      username
    }
  }
`;

const LOGIN = /* GraphQL */ `
  mutation ($input: LoginInput!) {
    login(input: $input) {
      token
    }
  }
`;

const ADD_COMMENT = /* GraphQL */ `
  mutation ($input: AddCommentInput!) {
    addComment(input: $input) {
      id
      body
      author {
        id
        username
      }
    }
  }
`;

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let host: string;
  let dataSource: DataSource;
  let alice: TestUser;
  let bob: TestUser;
  let post: Post;

  beforeAll(async () => {
    ({ app, host } = await startApp());
    dataSource = app.get(DataSource);
    alice = await registerAndLogin(host, 'alice-test');
    bob = await registerAndLogin(host, 'bob-test');
    post = await dataSource
      .getRepository(Post)
      .save({ title: 'Auth test', body: 'Auth test', authorId: bob.id });
  });

  afterAll(async () => {
    const ids = [alice?.id, bob?.id].filter(Boolean);
    // Cascades to the test post and comments.
    if (ids.length) await dataSource.getRepository(User).delete(ids);
    await app.close();
  });

  it('register and login return a JWT', () => {
    // registerAndLogin already went through both mutations.
    expect(alice.token).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
  });

  it('stores an argon2id hash, never the plain password', async () => {
    const row = await dataSource
      .getRepository(User)
      .findOneByOrFail({ id: alice.id });
    expect(row.passwordHash).toMatch(/^\$argon2id\$/);
    expect(row.passwordHash).not.toContain(alice.password);
  });

  it('login gives the same generic error for an unknown email and a wrong password', async () => {
    const wrongPassword = await gql(host, LOGIN, {
      input: { email: alice.email, password: 'wrong-password' },
    });
    const unknownEmail = await gql(host, LOGIN, {
      input: { email: 'nobody@example.com', password: alice.password },
    });
    expect(wrongPassword.errors?.[0].message).toBe('Invalid credentials');
    expect(unknownEmail.errors?.[0].message).toBe('Invalid credentials');
  });

  it('does not expose email or passwordHash in the schema', async () => {
    const res = await gql(host, 'query { me { email passwordHash } }');
    expect(res.errors?.map((e) => e.message)).toEqual([
      'Cannot query field "email" on type "User".',
      'Cannot query field "passwordHash" on type "User".',
    ]);
  });

  it('me returns the user of the token', async () => {
    const res = await gql<{ me: { id: string; username: string } }>(
      host,
      ME,
      undefined,
      alice.token,
    );
    expect(res.data?.me).toEqual({ id: alice.id, username: 'alice-test' });
  });

  it('me fails without a token or with a forged one', async () => {
    const anonymous = await gql(host, ME);
    const forged = await gql(host, ME, undefined, `${alice.token}x`);
    for (const res of [anonymous, forged]) {
      expect(res.data).toBeNull();
      expect(res.errors?.[0]).toMatchObject({
        message: 'Authentication required',
        extensions: { code: 'UNAUTHENTICATED' },
      });
    }
  });

  it('addComment fails without a token and creates nothing', async () => {
    const res = await gql(host, ADD_COMMENT, {
      input: { postId: post.id, body: 'anonymous' },
    });
    expect(res.errors?.[0]).toMatchObject({
      message: 'Authentication required',
    });
    expect(
      await dataSource.getRepository(Comment).countBy({ postId: post.id }),
    ).toBe(0);
  });

  it('addComment sets the author from the token', async () => {
    // Alice comments on Bob's post: the author must be Alice.
    const res = await gql<{
      addComment: { id: string; author: { id: string; username: string } };
    }>(
      host,
      ADD_COMMENT,
      { input: { postId: post.id, body: 'from alice' } },
      alice.token,
    );
    expect(res.errors).toBeUndefined();
    expect(res.data?.addComment.author).toEqual({
      id: alice.id,
      username: 'alice-test',
    });
    const stored = await dataSource
      .getRepository(Comment)
      .findOneByOrFail({ id: res.data!.addComment.id });
    expect(stored.authorId).toBe(alice.id);
  });

  it('rejects an authorId in the input (no impersonation)', async () => {
    const res = await gql(
      host,
      ADD_COMMENT,
      { input: { postId: post.id, body: 'as bob?', authorId: bob.id } },
      alice.token,
    );
    expect(res.errors?.[0].message).toContain(
      'Field "authorId" is not defined by type "AddCommentInput"',
    );
    expect(
      await dataSource
        .getRepository(Comment)
        .countBy({ postId: post.id, authorId: In([bob.id]) }),
    ).toBe(0);
  });

  it('refuses to register the same email twice', async () => {
    const res = await gql(
      host,
      'mutation ($input: RegisterInput!) { register(input: $input) { token } }',
      {
        input: {
          email: alice.email.toUpperCase(),
          username: 'alice-again',
          password: 'another-password',
        },
      },
    );
    expect(res.errors?.[0].message).toBe('Email already registered');
  });
});
