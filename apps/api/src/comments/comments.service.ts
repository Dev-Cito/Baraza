import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Comment } from './comment.entity';

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
}
