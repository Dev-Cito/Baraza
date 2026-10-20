import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import type { GraphQLContext } from '../graphql-context';
import { AuthService } from './auth.service';

@Injectable()
export class GqlAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const ctx =
      GqlExecutionContext.create(context).getContext<GraphQLContext>();
    // WebSocket: the user was already resolved at the handshake from
    // connectionParams. HTTP: resolve it from the Authorization header.
    ctx.user ??=
      (await this.authService.verifyBearer(ctx.req.headers.authorization)) ??
      undefined;
    if (!ctx.user) throw new UnauthorizedException('Authentication required');
    return true;
  }
}
