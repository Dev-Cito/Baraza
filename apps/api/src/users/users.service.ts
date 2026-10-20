import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from './user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  findById(id: string): Promise<User | null> {
    return this.users.findOneBy({ id });
  }

  findByIds(ids: readonly string[]): Promise<User[]> {
    return this.users.findBy({ id: In([...ids]) });
  }

  findByEmail(email: string): Promise<User | null> {
    return this.users.findOneBy({ email });
  }

  create(data: Pick<User, 'email' | 'username' | 'passwordHash'>) {
    return this.users.save(this.users.create(data));
  }
}
