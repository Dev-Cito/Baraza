import { UseGuards } from '@nestjs/common';
import {
  Args,
  Context,
  ID,
  Int,
  Mutation,
  Parent,
  Query,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';
import { CurrentUser } from '../auth/current-user.decorator';
import { GqlAuthGuard } from '../auth/gql-auth.guard';
import { Comment } from '../comments/comment.entity';
import type { Loaders } from '../loaders/loaders.service';
import { User } from '../users/user.entity';
import { CreatePostInput } from './dto/create-post.input';
import { Post } from './post.entity';
import { PostsService } from './posts.service';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// Field resolvers go through the per-request DataLoaders, so a list of N posts
// costs one batched query per field instead of N.
@Resolver(() => Post)
export class PostsResolver {
  constructor(private readonly postsService: PostsService) {}

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

  @Mutation(() => Post)
  @UseGuards(GqlAuthGuard)
  createPost(
    @Args('input') input: CreatePostInput,
    @CurrentUser() user: User,
  ): Promise<Post> {
    return this.postsService.create(input, user.id);
  }

  @ResolveField('author', () => User)
  async author(
    @Parent() post: Post,
    @Context('loaders') loaders: Loaders,
  ): Promise<User> {
    const user = await loaders.usersById.load(post.authorId);
    if (!user) throw new Error(`Author ${post.authorId} not found`);
    return user;
  }

  @ResolveField('comments', () => [Comment])
  comments(
    @Parent() post: Post,
    @Context('loaders') loaders: Loaders,
  ): Promise<Comment[]> {
    return loaders.commentsByPostId.load(post.id);
  }

  @ResolveField('commentCount', () => Int)
  commentCount(
    @Parent() post: Post,
    @Context('loaders') loaders: Loaders,
  ): Promise<number> {
    return loaders.commentCountByPostId.load(post.id);
  }
}
