import { Field, ID, ObjectType } from '@nestjs/graphql';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { Comment } from '../comments/comment.entity';
import { User } from '../users/user.entity';

// author, comments and commentCount are exposed through @ResolveField in
// PostsResolver, not as @Field here.
@ObjectType()
@Entity()
export class Post {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field()
  @Column()
  title: string;

  @Field()
  @Column({ type: 'text' })
  body: string;

  @ManyToOne(() => User, (user) => user.posts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'authorId' })
  author: Relation<User>;

  @Index()
  @Column('uuid')
  authorId: string;

  @OneToMany(() => Comment, (comment) => comment.post)
  comments: Relation<Comment[]>;

  @Field()
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
