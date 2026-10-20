import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { User } from '../users/user.entity';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { AuthPayload } from './dto/auth-payload.type';
import { LoginInput } from './dto/login.input';
import { RegisterInput } from './dto/register.input';
import { GqlAuthGuard } from './gql-auth.guard';

@Resolver()
export class AuthResolver {
  constructor(private readonly authService: AuthService) {}

  @Mutation(() => AuthPayload)
  register(@Args('input') input: RegisterInput): Promise<AuthPayload> {
    return this.authService.register(input);
  }

  @Mutation(() => AuthPayload)
  login(@Args('input') input: LoginInput): Promise<AuthPayload> {
    return this.authService.login(input);
  }

  @Query(() => User)
  @UseGuards(GqlAuthGuard)
  me(@CurrentUser() user: User): User {
    return user;
  }
}
