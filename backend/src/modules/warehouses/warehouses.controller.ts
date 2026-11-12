import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  NotEquals,
  ValidateNested,
} from 'class-validator';
import { WarehousesService } from './warehouses.service';
import { AuthenticatedUserPayload, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { MovementType } from '../../domain/entities/stock-movement.entity';

class AdjustMatrixCellDto {
  @IsInt()
  @NotEquals(0)
  @Min(-100)
  @Max(100)
  delta: number;
}

class NewProductPayloadDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  sku: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(140)
  name: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  category: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  unitOfMeasure: string;
}

class AdjustWarehouseInventoryDto {
  @IsIn(['INSERT', 'REMOVE'])
  action: 'INSERT' | 'REMOVE';

  @IsOptional()
  @IsString()
  @MaxLength(64)
  productId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => NewProductPayloadDto)
  newProduct?: NewProductPayloadDto;

  @IsInt()
  @Min(1)
  @Max(100000)
  quantity: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(200)
  row?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(200)
  col?: number;

  @IsOptional()
  @IsString()
  @MaxLength(140)
  partnerName?: string;
}

@Controller('warehouses')
@UseGuards(JwtAuthGuard)
export class WarehousesController {
  constructor(private readonly warehousesService: WarehousesService) {}

  @Get()
  async listWarehouses(@CurrentUser() user: AuthenticatedUserPayload) {
    return this.warehousesService.listBusinessWarehouses(user.businessId);
  }

  @Get(':id/dashboard')
  async getDashboard(
    @Param('id') warehouseId: string,
    @CurrentUser() user: AuthenticatedUserPayload,
  ) {
    return this.warehousesService.getDashboard(warehouseId, user.businessId);
  }

  @Get(':id/locations')
  async getLocations(
    @Param('id') warehouseId: string,
    @CurrentUser() user: AuthenticatedUserPayload,
  ) {
    return this.warehousesService.getLocations(warehouseId, user.businessId);
  }

  @Post(':id/matrix/:row/:col/adjust')
  async adjustMatrixCell(
    @Param('id') warehouseId: string,
    @Param('row', ParseIntPipe) row: number,
    @Param('col', ParseIntPipe) col: number,
    @Body() dto: AdjustMatrixCellDto,
    @CurrentUser() user: AuthenticatedUserPayload,
  ) {
    return this.warehousesService.adjustMatrixCellItems(
      warehouseId,
      user.businessId,
      row,
      col,
      dto.delta,
    );
  }

  @Get(':id/catalog')
  async getCatalog(
    @Param('id') warehouseId: string,
    @CurrentUser() user: AuthenticatedUserPayload,
  ) {
    return this.warehousesService.getCatalogProducts(warehouseId, user.businessId);
  }

  @Get(':id/inventory')
  async getInventory(
    @Param('id') warehouseId: string,
    @CurrentUser() user: AuthenticatedUserPayload,
  ) {
    return this.warehousesService.getInventory(warehouseId, user.businessId);
  }

  @Post(':id/inventory/adjust')
  async adjustInventory(
    @Param('id') warehouseId: string,
    @Body() dto: AdjustWarehouseInventoryDto,
    @CurrentUser() user: AuthenticatedUserPayload,
  ) {
    return this.warehousesService.adjustWarehouseInventory(warehouseId, user.businessId, dto);
  }

  @Get(':id/movements')
  async getMovements(
    @Param('id') warehouseId: string,
    @Query('type') type: string | undefined,
    @CurrentUser() user: AuthenticatedUserPayload,
  ) {
    const validType: MovementType | undefined =
      type === 'INBOUND' || type === 'OUTBOUND' ? type : undefined;
    return this.warehousesService.getMovements(warehouseId, user.businessId, validType);
  }
}
