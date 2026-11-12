import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { BcryptPasswordHasher, IPasswordHasher } from './password-hasher.service';
import { JwtAuthGuard } from './jwt-auth.guard';

@Global()
@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'wms-enterprise-super-secret-jwt-key-2026',
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtAuthGuard,
    {
      provide: IPasswordHasher,
      useClass: BcryptPasswordHasher,
    },
  ],
  exports: [AuthService, JwtAuthGuard, JwtModule, IPasswordHasher],
})
export class AuthModule {}

