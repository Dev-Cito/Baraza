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
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: join(process.cwd(), 'src/schema.gql'),
      sortSchema: true,
      // The legacy GraphQL Playground is deprecated; serve Apollo Sandbox on
      // /graphql in dev instead.
      playground: false,
      introspection: !isProduction,
      plugins: isProduction
        ? []
        : [ApolloServerPluginLandingPageLocalDefault()],
      // Expose the HTTP request to resolvers so auth can be added later.
      context: ({ req }: { req: Request }) => ({ req }),
    }),
    UsersModule,
    PostsModule,
    CommentsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
