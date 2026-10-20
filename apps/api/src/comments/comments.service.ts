import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Post } from '../posts/post.entity';
import { User } from '../users/user.entity';
import { Comment } from './comment.entity';
import { AddCommentInput } from './dto/add-comment.input';

const MAX_BODY_LENGTH = 5000;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class CommentsService {
  constructor(
    @InjectRepository(Comment) private readonly comments: Repository<Comment>,
  ) {}

  findByPostIds(postIds: readonly string[]): Promise<Comment[]> {
    return this.comments.find({
      where: { postId: In([...postIds]) },
      order: { createdAt: 'ASC' },
    });
  }

  async countByPostIds(
    postIds: readonly string[],
  ): Promise<{ postId: string; count: number }[]> {
    const rows = await this.comments
      .createQueryBuilder('comment')
      .select('comment.postId', 'postId')
      .addSelect('COUNT(*)', 'count')
      .where('comment.postId IN (:...postIds)', { postIds })
      .groupBy('comment.postId')
      .getRawMany<{ postId: string; count: string }>();
    // Postgres returns COUNT(*) as bigint, which the driver hands back as a string.
    return rows.map((row) => ({
      postId: row.postId,
      count: Number(row.count),
    }));
  }

  async create(input: AddCommentInput): Promise<Comment> {
    const body = input.body.trim();
    if (!body) throw new BadRequestException('Comment body cannot be empty');
    if (body.length > MAX_BODY_LENGTH) {
      throw new BadRequestException(
        `Comment body cannot exceed ${MAX_BODY_LENGTH} characters`,
      );
    }
    // Reject malformed ids up front: Postgres would fail on the uuid cast.
    if (!UUID_RE.test(input.postId) || !UUID_RE.test(input.authorId)) {
      throw new BadRequestException('postId and authorId must be UUIDs');
    }

    const { manager } = this.comments;
    const [postExists, authorExists] = await Promise.all([
      manager.existsBy(Post, { id: input.postId }),
      manager.existsBy(User, { id: input.authorId }),
    ]);
    if (!postExists) throw new NotFoundException('Post not found');
    if (!authorExists) throw new NotFoundException('Author not found');

    return this.comments.save(
      this.comments.create({
        body,
        postId: input.postId,
        authorId: input.authorId,
      }),
    );
  }
}
