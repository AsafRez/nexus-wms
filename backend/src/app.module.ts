import { Module } from '@nestjs/common';
import { DatabaseModule } from './infrastructure/database/database.module';
import { AiModule } from './modules/ai/ai.module';
import { AuthModule } from './modules/auth/auth.module';
import { WarehousesModule } from './modules/warehouses/warehouses.module';

@Module({
  imports: [DatabaseModule, AuthModule, WarehousesModule, AiModule],
})
export class AppModule {}
