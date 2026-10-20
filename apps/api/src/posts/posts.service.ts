import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Post } from './post.entity';

@Injectable()
export class PostsService {
  constructor(
    @InjectRepository(Post) private readonly posts: Repository<Post>,
  ) {}

  findAll(limit: number): Promise<Post[]> {
    return this.posts.find({ order: { createdAt: 'DESC' }, take: limit });
  }

  findById(id: string): Promise<Post | null> {
    return this.posts.findOneBy({ id });
  }
}
