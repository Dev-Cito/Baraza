import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreatePostInput } from './dto/create-post.input';
import { Post } from './post.entity';

const MAX_TITLE_LENGTH = 200;
// Twice the comment limit: posts are the long-form content of the forum.
const MAX_BODY_LENGTH = 10_000;

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

  create(input: CreatePostInput, authorId: string): Promise<Post> {
    const title = input.title.trim();
    const body = input.body.trim();
    if (!title) throw new BadRequestException('Post title cannot be empty');
    if (title.length > MAX_TITLE_LENGTH) {
      throw new BadRequestException(
        `Post title cannot exceed ${MAX_TITLE_LENGTH} characters`,
      );
    }
    if (!body) throw new BadRequestException('Post body cannot be empty');
    if (body.length > MAX_BODY_LENGTH) {
      throw new BadRequestException(
        `Post body cannot exceed ${MAX_BODY_LENGTH} characters`,
      );
    }

    return this.posts.save(this.posts.create({ title, body, authorId }));
  }
}
