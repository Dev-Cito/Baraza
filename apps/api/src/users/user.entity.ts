import { Field, ID, ObjectType } from '@nestjs/graphql';
import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { Comment } from '../comments/comment.entity';
import { Post } from '../posts/post.entity';

@ObjectType()
@Entity()
export class User {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Private: deliberately not a @Field, so it never reaches the public schema.
  @Column({ unique: true })
  email: string;

  // Never expose this.
  @Column()
  passwordHash: string;

  @Field()
  @Column()
  username: string;

  @Field()
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @OneToMany(() => Post, (post) => post.author)
  posts: Relation<Post[]>;

  @OneToMany(() => Comment, (comment) => comment.author)
  comments: Relation<Comment[]>;
}
