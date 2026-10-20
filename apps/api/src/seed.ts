import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { randomBytes, scryptSync } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from './app.module';
import { Comment } from './comments/comment.entity';
import { Post } from './posts/post.entity';
import { User } from './users/user.entity';

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

const USERS = [
  { username: 'amani', email: 'amani@example.com' },
  { username: 'baraka', email: 'baraka@example.com' },
  { username: 'chausiku', email: 'chausiku@example.com' },
];

// [title, body, author index]
const POSTS: [string, string, number][] = [
  ['Welcome to Baraza', 'Introduce yourself here.', 0],
  ['GraphQL vs REST', 'Which one do you reach for first, and why?', 1],
  ['Favourite Postgres tricks', 'Share your best indexes and CTEs.', 2],
  ['NestJS module layout', 'How do you split modules in a growing API?', 0],
  ['Weekend reading', 'What are you reading this week?', 1],
];

// [post index, author index, body]
const COMMENTS: [number, number, string][] = [
  [0, 1, 'Hi all, glad to be here.'],
  [0, 2, 'Hello from Kigali!'],
  [0, 0, 'Welcome both of you.'],
  [1, 0, 'REST for simple CRUD, GraphQL for nested reads.'],
  [1, 2, 'GraphQL, but watch out for N+1.'],
  [1, 1, 'Agreed on N+1, DataLoader helps.'],
  [2, 0, 'Partial indexes are underrated.'],
  [2, 1, 'LATERAL joins changed my life.'],
  [3, 2, 'One module per bounded context.'],
  [3, 1, 'Keep shared code in a common module.'],
  [3, 0, 'Avoid circular module imports.'],
  [4, 2, 'Designing Data-Intensive Applications, again.'],
  [4, 0, 'The Pragmatic Programmer.'],
];

async function seed() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const users = app.get<Repository<User>>(getRepositoryToken(User));
  const posts = app.get<Repository<Post>>(getRepositoryToken(Post));
  const comments = app.get<Repository<Comment>>(getRepositoryToken(Comment));

  // Start from a clean slate so the seed can be re-run.
  await app
    .get(DataSource)
    .query('TRUNCATE "comment", "post", "user" RESTART IDENTITY CASCADE');

  const savedUsers = await users.save(
    USERS.map((u) =>
      users.create({ ...u, passwordHash: hashPassword('password123') }),
    ),
  );

  // Spread createdAt so ordering by date is deterministic.
  const base = Date.now() - POSTS.length * 3_600_000;
  const savedPosts: Post[] = [];
  for (const [i, [title, body, author]] of POSTS.entries()) {
    savedPosts.push(
      await posts.save(
        posts.create({
          title,
          body,
          authorId: savedUsers[author].id,
          createdAt: new Date(base + i * 3_600_000),
        }),
      ),
    );
  }

  await comments.save(
    COMMENTS.map(([post, author, body], i) =>
      comments.create({
        body,
        postId: savedPosts[post].id,
        authorId: savedUsers[author].id,
        createdAt: new Date(base + i * 60_000 + 1_800_000),
      }),
    ),
  );

  console.log(
    `Seeded ${savedUsers.length} users, ${savedPosts.length} posts, ${COMMENTS.length} comments.`,
  );
  await app.close();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
