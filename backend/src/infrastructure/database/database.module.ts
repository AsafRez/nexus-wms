import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { USER_REPOSITORY } from '../../domain/repositories/user.repository.interface';
import { WAREHOUSE_REPOSITORY } from '../../domain/repositories/warehouse.repository.interface';
import { PrismaUserRepository } from '../repositories/prisma-user.repository';
import { PrismaWarehouseRepository } from '../repositories/prisma-warehouse.repository';

@Global()
@Module({
  providers: [
    PrismaService,
    {
      provide: USER_REPOSITORY,
      useClass: PrismaUserRepository,
    },
    {
      provide: WAREHOUSE_REPOSITORY,
      useClass: PrismaWarehouseRepository,
    },
  ],
  exports: [PrismaService, USER_REPOSITORY, WAREHOUSE_REPOSITORY],
})
export class DatabaseModule {}

