import { Inject } from '@nestjs/common';
import {
  Args,
  Context,
  ID,
  Mutation,
  Parent,
  ResolveField,
  Resolver,
  Subscription,
} from '@nestjs/graphql';
import { PubSubEngine } from 'graphql-subscriptions';
import type { Loaders } from '../loaders/loaders.service';
import { PUB_SUB } from '../pubsub/pubsub.module';
import { User } from '../users/user.entity';
import { Comment } from './comment.entity';
import { CommentsService } from './comments.service';
import { AddCommentInput } from './dto/add-comment.input';

const COMMENT_ADDED = 'commentAdded';

interface CommentAddedPayload {
  commentAdded: Comment;
}

@Resolver(() => Comment)
export class CommentsResolver {
  constructor(
    private readonly commentsService: CommentsService,
    @Inject(PUB_SUB) private readonly pubSub: PubSubEngine,
  ) {}

  @Mutation(() => Comment)
  async addComment(@Args('input') input: AddCommentInput): Promise<Comment> {
    // Persist first, publish second: subscribers must never receive a comment
    // that is not in the database.
    const comment = await this.commentsService.create(input);
    await this.pubSub.publish(COMMENT_ADDED, {
      commentAdded: comment,
    } satisfies CommentAddedPayload);
    return comment;
  }

  @Subscription(() => Comment, {
    filter: (
      payload: CommentAddedPayload,
      variables: { postId: string },
    ): boolean => payload.commentAdded.postId === variables.postId,
  })
  commentAdded(
    // Declares the argument in the schema; its value is read by the filter.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    @Args('postId', { type: () => ID }) postId: string,
  ): AsyncIterator<CommentAddedPayload> {
    return this.pubSub.asyncIterableIterator<CommentAddedPayload>(
      COMMENT_ADDED,
    );
  }

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
