import { Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { Comment } from './comment.entity';

@Resolver(() => Comment)
export class CommentsResolver {
  constructor(private readonly usersService: UsersService) {}

  // Naive on purpose: one SELECT per comment (N+1). DataLoader comes later.
  @ResolveField('author', () => User)
  async author(@Parent() comment: Comment): Promise<User> {
    const user = await this.usersService.findById(comment.authorId);
    if (!user) throw new Error(`Author ${comment.authorId} not found`);
    return user;
  }
}
