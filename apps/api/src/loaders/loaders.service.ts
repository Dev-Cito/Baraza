import { Injectable } from '@nestjs/common';
import DataLoader from 'dataloader';
import { Comment } from '../comments/comment.entity';
import { CommentsService } from '../comments/comments.service';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';

export interface Loaders {
  usersById: DataLoader<string, User | null>;
  commentsByPostId: DataLoader<string, Comment[]>;
  commentCountByPostId: DataLoader<string, number>;
}

// Singleton factory: the service itself holds no cache. Each call to create()
// returns brand-new DataLoader instances, and the GraphQL context calls it once
// per request, so loader caches never leak between requests or users.
@Injectable()
export class LoadersService {
  constructor(
    private readonly usersService: UsersService,
    private readonly commentsService: CommentsService,
  ) {}

  create(): Loaders {
    return {
      usersById: new DataLoader(async (ids) => {
        const users = await this.usersService.findByIds(ids);
        const byId = new Map(users.map((user) => [user.id, user]));
        return ids.map((id) => byId.get(id) ?? null);
      }),

      commentsByPostId: new DataLoader(async (postIds) => {
        const comments = await this.commentsService.findByPostIds(postIds);
        const byPostId = new Map<string, Comment[]>(
          postIds.map((id) => [id, []]),
        );
        for (const comment of comments) {
          byPostId.get(comment.postId)?.push(comment);
        }
        return postIds.map((id) => byPostId.get(id) ?? []);
      }),

      commentCountByPostId: new DataLoader(async (postIds) => {
        const rows = await this.commentsService.countByPostIds(postIds);
        const byPostId = new Map(rows.map((row) => [row.postId, row.count]));
        return postIds.map((id) => byPostId.get(id) ?? 0);
      }),
    };
  }
}
