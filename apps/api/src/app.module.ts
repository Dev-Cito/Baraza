import { ApolloServerPluginLandingPageLocalDefault } from '@apollo/server/plugin/landingPage/default';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { Request } from 'express';
import type { Context as WsContext } from 'graphql-ws';
import type { Extra as WsExtra } from 'graphql-ws/use/ws';
import { join } from 'node:path';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { AuthService } from './auth/auth.service';
import { CommentsModule } from './comments/comments.module';
import type { GraphQLContext } from './graphql-context';
import { LoadersModule } from './loaders/loaders.module';
import { LoadersService } from './loaders/loaders.service';
import { PostsModule } from './posts/posts.module';
import { RedactedSqlLogger } from './redacted-sql.logger';
import type { User } from './users/user.entity';
import { UsersModule } from './users/users.module';

const isProduction = process.env.NODE_ENV === 'production';

// Set by onConnect once the handshake token is verified.
type AuthedWsExtra = WsExtra & { user?: User };

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.getOrThrow<string>('DATABASE_URL'),
        autoLoadEntities: true,
        // Opt-in for local dev only; production never auto-syncs the schema,
        // even if the variable is set by mistake.
        synchronize:
          !isProduction && config.get('DATABASE_SYNCHRONIZE') === 'true',
        // Deliberately verbose in dev so N+1 queries are visible in the logs.
        // Parameters are never logged: they can hold hashes and emails.
        logger: new RedactedSqlLogger(
          isProduction ? ['error'] : ['query', 'error'],
        ),
        // Managed Postgres providers need SSL with an unverifiable chain;
        // local Docker Postgres has none, so this is opt-in via env.
        ssl:
          config.get('DATABASE_SSL') === 'true'
            ? { rejectUnauthorized: false }
            : false,
      }),
    }),
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      imports: [LoadersModule, AuthModule],
      inject: [LoadersService, AuthService],
      useFactory: (
        loadersService: LoadersService,
        authService: AuthService,
      ) => ({
        autoSchemaFile: join(process.cwd(), 'src/schema.gql'),
        sortSchema: true,
        // The legacy GraphQL Playground is deprecated; serve Apollo Sandbox on
        // /graphql in dev instead.
        playground: false,
        introspection: !isProduction,
        plugins: isProduction
          ? []
          : [ApolloServerPluginLandingPageLocalDefault()],
        // Subscriptions over graphql-ws on the same /graphql endpoint (the
        // legacy subscriptions-transport-ws protocol stays disabled).
        subscriptions: {
          'graphql-ws': {
            // Runs once per connection, on connection_init. Browsers cannot
            // set headers on a WebSocket, so the token travels in
            // connectionParams: { authorization: 'Bearer <jwt>' }.
            onConnect: async (ctx) => {
              const authorization = ctx.connectionParams?.authorization;
              // No token: anonymous connection, accepted. Public operations
              // (commentAdded) work; guarded ones will refuse it. Empty
              // values count as "no token" since some clients always send
              // the key.
              if (
                authorization === undefined ||
                authorization === null ||
                authorization === ''
              ) {
                return true;
              }
              const user = await authService.verifyBearer(authorization);
              // A token was sent but is invalid or expired: never fall back to
              // anonymous, close with 4403 Forbidden.
              if (!user) return false;
              (ctx.extra as AuthedWsExtra).user = user;
              return true;
            },
          },
        },
        context: (
          arg:
            | { req: Request }
            | WsContext<Record<string, unknown>, AuthedWsExtra>,
        ): GraphQLContext => {
          if ('extra' in arg) {
            // graphql-ws calls this once per operation (subscribe message), and
            // graphql-js then reuses that context for every event the
            // subscription emits. Cached loaders would keep serving the rows
            // from the first event for the whole subscription, so WebSocket
            // operations get non-caching loaders (batching still applies).
            return {
              req: arg.extra.request,
              connectionParams: arg.connectionParams,
              user: arg.extra.user,
              loaders: loadersService.create({ cache: false }),
            };
          }
          // HTTP: called once per request, so cached loaders are safe and
          // deduplicate lookups within that request.
          return { req: arg.req, loaders: loadersService.create() };
        },
      }),
    }),
    UsersModule,
    AuthModule,
    PostsModule,
    CommentsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
