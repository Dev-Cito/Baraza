import { Context, Parent, ResolveField, Resolver } from '@nestjs/graphql';
import type { Loaders } from '../loaders/loaders.service';
import { User } from '../users/user.entity';
import { Comment } from './comment.entity';

@Resolver(() => Comment)
export class CommentsResolver {
  @ResolveField('author', () => User)
  async author(
    @Parent() comment: Comment,
    @Context('loaders') loaders: Loaders,
  ): Promise<User> {
    const user = await loaders.usersById.load(comment.authorId);
    if (!user) throw new Error(`Author ${comment.authorId} not found`);
    return user;
  }
}
