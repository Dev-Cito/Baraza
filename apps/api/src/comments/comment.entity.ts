import { Field, ID, ObjectType } from '@nestjs/graphql';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { Post } from '../posts/post.entity';
import { User } from '../users/user.entity';

// author is exposed through @ResolveField in CommentsResolver.
@ObjectType()
@Entity()
export class Comment {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field()
  @Column({ type: 'text' })
  body: string;

  @ManyToOne(() => Post, (post) => post.comments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'postId' })
  post: Relation<Post>;

  @Index()
  @Column('uuid')
  postId: string;

  @ManyToOne(() => User, (user) => user.comments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'authorId' })
  author: Relation<User>;

  @Index()
  @Column('uuid')
  authorId: string;

  @Field()
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
