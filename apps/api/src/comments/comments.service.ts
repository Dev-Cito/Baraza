import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Comment } from './comment.entity';

@Injectable()
export class CommentsService {
  constructor(
    @InjectRepository(Comment) private readonly comments: Repository<Comment>,
  ) {}

  findByPostId(postId: string): Promise<Comment[]> {
    return this.comments.find({
      where: { postId },
      order: { createdAt: 'ASC' },
    });
  }

  countByPostId(postId: string): Promise<number> {
    return this.comments.countBy({ postId });
  }
}
