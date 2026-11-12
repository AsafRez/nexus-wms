import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  IUserRepository,
  USER_REPOSITORY,
} from '../../domain/repositories/user.repository.interface';
import { IPasswordHasher } from './password-hasher.service';
import { LoginDto } from './dto/login.dto';
import { UserEntity } from '../../domain/entities/user.entity';

@Injectable()
export class AuthService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: IUserRepository,
    private readonly passwordHasher: IPasswordHasher,
    private readonly jwtService: JwtService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.userRepository.findByEmail(dto.email);
    if (!user) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const isPasswordValid = await this.passwordHasher.compare(dto.password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    try {
      user.business.assertCanOperate();
    } catch (err) {
      throw new ForbiddenException((err as Error).message);
    }

    const payload = {
      sub: user.id,
      email: user.email,
      businessId: user.businessId,
      role: user.role,
    };

    const accessToken = await this.jwtService.signAsync(payload);

    return {
      accessToken,
      user: this.serializeUser(user),
    };
  }

  async getProfile(userId: string) {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User account no longer exists.');
    }
    return this.serializeUser(user);
  }

  private serializeUser(user: UserEntity) {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      business: {
        id: user.business.id,
        name: user.business.name,
        code: user.business.code,
        industry: user.business.industry,
      },
    };
  }
}

