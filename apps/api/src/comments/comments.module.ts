import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { PubSubModule } from '../pubsub/pubsub.module';
import { Comment } from './comment.entity';
import { CommentsResolver } from './comments.resolver';
import { CommentsService } from './comments.service';

@Module({
  imports: [TypeOrmModule.forFeature([Comment]), PubSubModule, AuthModule],
  providers: [CommentsService, CommentsResolver],
  exports: [CommentsService],
})
export class CommentsModule {}
