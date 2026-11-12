import { WarehouseEntity } from '../entities/warehouse.entity';
import { StorageLocationEntity } from '../entities/storage-location.entity';
import { ItemInventoryEntity } from '../entities/item-inventory.entity';
import { StockMovementEntity, MovementType } from '../entities/stock-movement.entity';
import { ProductEntity } from '../entities/product.entity';

export const WAREHOUSE_REPOSITORY = Symbol('WAREHOUSE_REPOSITORY');

export class InventoryConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InventoryConflictError';
  }
}

export interface WarehouseMetricsSnapshot {
  totalSkusStored: number;
  totalUnitsInStock: number;
  pendingInboundCount: number;
  pendingOutboundCount: number;
}

export interface InventoryTransactionCommand {
  warehouse: WarehouseEntity;
  action: 'INSERT' | 'REMOVE';
  quantity: number;
  updatedCell: StorageLocationEntity | null;
  productId?: string;
  newProduct?: {
    businessId: string;
    sku: string;
    name: string;
    category: string;
    unitOfMeasure: string;
  };
  movement: {
    type: MovementType;
    referenceCode: string;
    partnerName: string;
    locationCode: string | null;
    quantity: number;
  };
}

export interface InventoryTransactionResult {
  movement: StockMovementEntity;
  warehouseUsedCapacity: number;
  warehouseTotalItems: number;
  cellCurrentItems: number | null;
}

export interface IWarehouseRepository {
  findAllByBusinessId(businessId: string): Promise<WarehouseEntity[]>;
  findByIdAndBusinessId(warehouseId: string, businessId: string): Promise<WarehouseEntity | null>;
  findWithMatrixByIdAndBusinessId(
    warehouseId: string,
    businessId: string,
  ): Promise<WarehouseEntity | null>;
  saveCellAndWarehouseCounters(
    warehouse: WarehouseEntity,
    cell: StorageLocationEntity,
    delta: number,
  ): Promise<void>;
  getWarehouseMetrics(warehouseId: string): Promise<WarehouseMetricsSnapshot>;
  getInventoryItems(warehouseId: string): Promise<ItemInventoryEntity[]>;
  findInventoryItem(warehouseId: string, productId: string): Promise<ItemInventoryEntity | null>;
  getBusinessProducts(businessId: string): Promise<ProductEntity[]>;
  findProductByIdAndBusinessId(
    productId: string,
    businessId: string,
  ): Promise<ProductEntity | null>;
  findProductBySkuAndBusinessId(sku: string, businessId: string): Promise<ProductEntity | null>;
  executeInventoryTransaction(
    cmd: InventoryTransactionCommand,
  ): Promise<InventoryTransactionResult>;
  getMovements(
    warehouseId: string,
    type?: MovementType,
    limit?: number,
  ): Promise<StockMovementEntity[]>;
}
