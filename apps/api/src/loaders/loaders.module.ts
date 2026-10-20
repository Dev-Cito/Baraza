import { Module } from '@nestjs/common';
import { CommentsModule } from '../comments/comments.module';
import { UsersModule } from '../users/users.module';
import { LoadersService } from './loaders.service';

@Module({
  imports: [UsersModule, CommentsModule],
  providers: [LoadersService],
  exports: [LoadersService],
})
export class LoadersModule {}
