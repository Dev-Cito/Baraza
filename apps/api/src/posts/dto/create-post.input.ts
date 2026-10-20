import { Field, InputType } from '@nestjs/graphql';

// No authorId: the author is always the authenticated user (from the JWT).
@InputType()
export class CreatePostInput {
  @Field()
  title: string;

  @Field()
  body: string;
}
