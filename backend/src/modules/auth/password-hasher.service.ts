import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';

export abstract class IPasswordHasher {
  abstract hash(plainText: string): Promise<string>;
  abstract compare(plainText: string, hashed: string): Promise<boolean>;
}

@Injectable()
export class BcryptPasswordHasher extends IPasswordHasher {
  private readonly saltRounds = 10;

  async hash(plainText: string): Promise<string> {
    return bcrypt.hash(plainText, this.saltRounds);
  }

  async compare(plainText: string, hashed: string): Promise<boolean> {
    return bcrypt.compare(plainText, hashed);
  }
}

