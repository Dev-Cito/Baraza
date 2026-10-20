import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import type { GraphQLContext } from '../graphql-context';
import type { User } from '../users/user.entity';

// The authenticated user set by GqlAuthGuard. Only use behind that guard.
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): User => {
    const { user } =
      GqlExecutionContext.create(context).getContext<GraphQLContext>();
    // Fails closed if a resolver uses @CurrentUser without the guard.
    if (!user) throw new UnauthorizedException('Authentication required');
    return user;
  },
);
