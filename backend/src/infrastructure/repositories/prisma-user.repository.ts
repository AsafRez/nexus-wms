import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { IUserRepository } from '../../domain/repositories/user.repository.interface';
import { UserEntity, UserRole } from '../../domain/entities/user.entity';
import { BusinessEntity } from '../../domain/entities/business.entity';

@Injectable()
export class PrismaUserRepository implements IUserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByEmail(email: string): Promise<UserEntity | null> {
    const record = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: { business: true },
    });

    if (!record) return null;
    return this.toDomain(record);
  }

  async findById(id: string): Promise<UserEntity | null> {
    const record = await this.prisma.user.findUnique({
      where: { id },
      include: { business: true },
    });

    if (!record) return null;
    return this.toDomain(record);
  }

  private toDomain(record: {
    id: string;
    email: string;
    passwordHash: string;
    fullName: string;
    role: string;
    createdAt: Date;
    updatedAt: Date;
    business: {
      id: string;
      name: string;
      code: string;
      industry: string;
      isActive: boolean;
      createdAt: Date;
      updatedAt: Date;
    };
  }): UserEntity {
    const business = new BusinessEntity({
      id: record.business.id,
      name: record.business.name,
      code: record.business.code,
      industry: record.business.industry,
      isActive: record.business.isActive,
      createdAt: record.business.createdAt,
      updatedAt: record.business.updatedAt,
    });

    return new UserEntity({
      id: record.id,
      email: record.email,
      passwordHash: record.passwordHash,
      fullName: record.fullName,
      role: record.role as UserRole,
      business,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  }
}

