import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from '../users/users.module';
import { AuthResolver } from './auth.resolver';
import { AuthService } from './auth.service';
import { GqlAuthGuard } from './gql-auth.guard';

const MIN_SECRET_LENGTH = 32;

@Module({
  imports: [
    UsersModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.getOrThrow<string>('JWT_SECRET');
        if (secret.length < MIN_SECRET_LENGTH) {
          throw new Error(
            `JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters`,
          );
        }
        return {
          secret,
          signOptions: {
            algorithm: 'HS256',
            // Format accepted by jsonwebtoken, e.g. "15m", "1h", "7d".
            expiresIn: config.getOrThrow('JWT_EXPIRES_IN'),
          },
          // Pin the algorithm so a token can't choose its own (e.g. "none").
          verifyOptions: { algorithms: ['HS256'] },
        };
      },
    }),
  ],
  providers: [AuthService, AuthResolver, GqlAuthGuard],
  exports: [AuthService, GqlAuthGuard],
})
export class AuthModule {}
