import {
  Args,
  ID,
  Int,
  Parent,
  Query,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';
import { Comment } from '../comments/comment.entity';
import { CommentsService } from '../comments/comments.service';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { Post } from './post.entity';
import { PostsService } from './posts.service';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// The field resolvers below are naive on purpose: each one hits the database
// once per parent post, so a list of N posts triggers the N+1 problem.
// DataLoader comes in the next step.
@Resolver(() => Post)
export class PostsResolver {
  constructor(
    private readonly postsService: PostsService,
    private readonly usersService: UsersService,
    private readonly commentsService: CommentsService,
  ) {}

  @Query(() => [Post])
  posts(
    @Args('limit', { type: () => Int, nullable: true }) limit?: number,
  ): Promise<Post[]> {
    const take = Math.min(Math.max(limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    return this.postsService.findAll(take);
  }

  @Query(() => Post, { nullable: true })
  post(@Args('id', { type: () => ID }) id: string): Promise<Post | null> {
    return this.postsService.findById(id);
  }

  @ResolveField('author', () => User)
  async author(@Parent() post: Post): Promise<User> {
    const user = await this.usersService.findById(post.authorId);
    if (!user) throw new Error(`Author ${post.authorId} not found`);
    return user;
  }

  @ResolveField('comments', () => [Comment])
  comments(@Parent() post: Post): Promise<Comment[]> {
    return this.commentsService.findByPostId(post.id);
  }

  @ResolveField('commentCount', () => Int)
  commentCount(@Parent() post: Post): Promise<number> {
    return this.commentsService.countByPostId(post.id);
  }
}
