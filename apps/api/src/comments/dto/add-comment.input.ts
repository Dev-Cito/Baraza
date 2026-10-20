import { Field, ID, InputType } from '@nestjs/graphql';

@InputType()
export class AddCommentInput {
  @Field(() => ID)
  postId: string;

  // Temporary until auth lands: the author will then come from the
  // authenticated user, not from client input.
  @Field(() => ID)
  authorId: string;

  @Field()
  body: string;
}
