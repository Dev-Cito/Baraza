import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { QueryFailedError } from 'typeorm';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { AuthPayload } from './dto/auth-payload.type';
import { LoginInput } from './dto/login.input';
import { RegisterInput } from './dto/register.input';
import { hashPassword, verifyPassword } from './password';

interface JwtPayload {
  sub: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[A-Za-z0-9_-]{3,30}$/;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

@Injectable()
export class AuthService {
  // Verified against when the email is unknown, so a login attempt costs the
  // same time whether or not the account exists.
  private dummyHash?: Promise<string>;

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async register(input: RegisterInput): Promise<AuthPayload> {
    const email = normalizeEmail(input.email);
    const username = input.username.trim();
    if (!EMAIL_RE.test(email)) throw new BadRequestException('Invalid email');
    if (!USERNAME_RE.test(username)) {
      throw new BadRequestException(
        'Username must be 3-30 characters: letters, digits, _ or -',
      );
    }
    if (
      input.password.length < MIN_PASSWORD_LENGTH ||
      input.password.length > MAX_PASSWORD_LENGTH
    ) {
      throw new BadRequestException(
        `Password must be ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters`,
      );
    }
    // Deliberate trade-off: an explicit message is better UX, at the cost of
    // letting anyone check whether an email has an account (enumeration).
    // login stays generic and constant-time so it does not help with that.
    // See "Security" in the README.
    if (await this.usersService.findByEmail(email)) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await hashPassword(input.password);
    let user: User;
    try {
      user = await this.usersService.create({ email, username, passwordHash });
    } catch (err) {
      // Lost a race with a concurrent registration of the same email.
      if (isUniqueViolation(err)) {
        throw new ConflictException('Email already registered');
      }
      throw err;
    }
    return { token: await this.sign(user), user };
  }

  async login(input: LoginInput): Promise<AuthPayload> {
    const user = await this.usersService.findByEmail(
      normalizeEmail(input.email),
    );
    if (!user) {
      this.dummyHash ??= hashPassword('dummy-password-for-timing');
      await verifyPassword(await this.dummyHash, input.password);
      throw new UnauthorizedException('Invalid credentials');
    }
    if (!(await verifyPassword(user.passwordHash, input.password))) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return { token: await this.sign(user), user };
  }

  // Resolves an "Authorization: Bearer <jwt>" value to its user. Returns null
  // for anything missing, malformed, expired, or pointing at a deleted user;
  // callers decide whether that is an error. Shared by the HTTP guard and the
  // WebSocket handshake so both transports verify tokens identically.
  async verifyBearer(authorization: unknown): Promise<User | null> {
    if (typeof authorization !== 'string') return null;
    const [scheme, token] = authorization.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
    try {
      const { sub } = await this.jwtService.verifyAsync<JwtPayload>(token);
      return typeof sub === 'string'
        ? await this.usersService.findById(sub)
        : null;
    } catch {
      return null;
    }
  }

  private sign(user: User): Promise<string> {
    return this.jwtService.signAsync({ sub: user.id } satisfies JwtPayload);
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof QueryFailedError &&
    (err.driverError as { code?: string }).code === '23505'
  );
}
