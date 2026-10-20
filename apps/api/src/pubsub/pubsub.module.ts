import { Module } from '@nestjs/common';
import { PubSub } from 'graphql-subscriptions';

// Resolvers depend on this token and the PubSubEngine type only, so the
// in-memory implementation can be swapped for a Redis-backed one (multi-instance)
// by changing this provider alone.
export const PUB_SUB = Symbol('PUB_SUB');

@Module({
  providers: [{ provide: PUB_SUB, useValue: new PubSub() }],
  exports: [PUB_SUB],
})
export class PubSubModule {}
