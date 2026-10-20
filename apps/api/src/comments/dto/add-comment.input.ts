import { Field, ID, InputType } from '@nestjs/graphql';

// No authorId: the author is always the authenticated user (from the JWT).
@InputType()
export class AddCommentInput {
  @Field(() => ID)
  postId: string;

  @Field()
  body: string;
}
