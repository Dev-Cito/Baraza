import { ApolloServerPluginLandingPageLocalDefault } from '@apollo/server/plugin/landingPage/default';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { Request } from 'express';
import { join } from 'node:path';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CommentsModule } from './comments/comments.module';
import type { GraphQLContext } from './graphql-context';
import { LoadersModule } from './loaders/loaders.module';
import { LoadersService } from './loaders/loaders.service';
import { PostsModule } from './posts/posts.module';
import { UsersModule } from './users/users.module';

const isProduction = process.env.NODE_ENV === 'production';

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
        logging: isProduction ? ['error'] : ['query', 'error'],
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
      imports: [LoadersModule],
      inject: [LoadersService],
      useFactory: (loadersService: LoadersService) => ({
        autoSchemaFile: join(process.cwd(), 'src/schema.gql'),
        sortSchema: true,
        // The legacy GraphQL Playground is deprecated; serve Apollo Sandbox on
        // /graphql in dev instead.
        playground: false,
        introspection: !isProduction,
        plugins: isProduction
          ? []
          : [ApolloServerPluginLandingPageLocalDefault()],
        // Built once per GraphQL request: exposes the HTTP request (for auth
        // later) and a fresh set of DataLoaders so caches are never shared
        // across requests.
        context: ({ req }: { req: Request }): GraphQLContext => ({
          req,
          loaders: loadersService.create(),
        }),
      }),
    }),
    UsersModule,
    PostsModule,
    CommentsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
