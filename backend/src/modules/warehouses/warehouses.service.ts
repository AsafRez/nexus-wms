import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  InventoryConflictError,
  IWarehouseRepository,
  WAREHOUSE_REPOSITORY,
} from '../../domain/repositories/warehouse.repository.interface';
import { WarehouseEntity } from '../../domain/entities/warehouse.entity';
import { StorageLocationEntity } from '../../domain/entities/storage-location.entity';
import { MovementType, StockMovementEntity } from '../../domain/entities/stock-movement.entity';
import { ProductEntity } from '../../domain/entities/product.entity';

export interface AdjustWarehouseInventoryInput {
  action: 'INSERT' | 'REMOVE';
  productId?: string;
  newProduct?: {
    sku: string;
    name: string;
    category: string;
    unitOfMeasure: string;
  };
  quantity: number;
  row?: number;
  col?: number;
  partnerName?: string;
}

@Injectable()
export class WarehousesService {
  constructor(
    @Inject(WAREHOUSE_REPOSITORY)
    private readonly warehouseRepository: IWarehouseRepository,
  ) {}

  async listBusinessWarehouses(businessId: string) {
    const warehouses = await this.warehouseRepository.findAllByBusinessId(businessId);
    return warehouses.map((wh) => this.serializeWarehouseSummary(wh));
  }

  async getDashboard(warehouseId: string, businessId: string) {
    const warehouse = await this.assertWarehouseWithMatrix(warehouseId, businessId);
    const [metrics, recentMovements] = await Promise.all([
      this.warehouseRepository.getWarehouseMetrics(warehouse.id),
      this.warehouseRepository.getMovements(warehouse.id, undefined, 8),
    ]);

    const rawMatrix = warehouse.matrix ?? [];
    const serializedMatrix = rawMatrix.map((rowCells) =>
      rowCells.map((cell) => this.serializeCell(cell)),
    );

    const rowBreakdown = rawMatrix.map((rowCells, rowIdx) => {
      const totalPlaces = rowCells.length;
      const usedPlaces = rowCells.filter((c) => c.isOccupied).length;
      const totalItemsInRow = rowCells.reduce((sum, c) => sum + c.currentItems, 0);
      return {
        rowLabel: `Row ${String.fromCharCode(65 + rowIdx)}`,
        rowIndex: rowIdx,
        totalPlaces,
        usedPlaces,
        totalItemsInRow,
        occupancyPercentage:
          totalPlaces === 0 ? 0 : Math.round((usedPlaces / totalPlaces) * 1000) / 10,
      };
    });

    return {
      warehouse: this.serializeWarehouseSummary(warehouse),
      matrix: serializedMatrix,
      metrics,
      rowBreakdown,
      recentMovements: recentMovements.map((m) => this.serializeMovement(m)),
    };
  }

  async getLocations(warehouseId: string, businessId: string) {
    const warehouse = await this.assertWarehouseWithMatrix(warehouseId, businessId);
    const flat: ReturnType<typeof this.serializeCell>[] = [];
    for (const rowCells of warehouse.matrix ?? []) {
      for (const cell of rowCells) {
        flat.push(this.serializeCell(cell));
      }
    }
    return flat;
  }

  async adjustMatrixCellItems(
    warehouseId: string,
    businessId: string,
    row: number,
    col: number,
    delta: number,
  ) {
    if (!Number.isInteger(delta) || delta === 0) {
      throw new BadRequestException('Item delta must be a non-zero integer.');
    }

    const warehouse = await this.assertWarehouseWithMatrix(warehouseId, businessId);

    try {
      const targetCell = warehouse.getCell(row, col);
      if (delta > 0 && (!targetCell.isOccupied || !targetCell.product)) {
        throw new BadRequestException(
          `Cell ${targetCell.code} is empty and has no product assigned. Use Manage Stock (Insert) to assign a SKU first.`,
        );
      }

      const updatedCell =
        delta > 0
          ? warehouse.addItemsAt(row, col, delta)
          : warehouse.removeItemsAt(row, col, Math.abs(delta));

      await this.warehouseRepository.saveCellAndWarehouseCounters(warehouse, updatedCell, delta);
      const refreshedWh = await this.assertWarehouseOwnership(warehouseId, businessId);

      return {
        warehouse: this.serializeWarehouseSummary(refreshedWh),
        cell: this.serializeCell(updatedCell),
      };
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException((err as Error).message);
    }
  }

  async getCatalogProducts(warehouseId: string, businessId: string) {
    await this.assertWarehouseOwnership(warehouseId, businessId);
    const products = await this.warehouseRepository.getBusinessProducts(businessId);
    return products.map((p) => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      category: p.category,
      unitOfMeasure: p.unitOfMeasure,
    }));
  }

  async getInventory(warehouseId: string, businessId: string) {
    await this.assertWarehouseOwnership(warehouseId, businessId);
    const items = await this.warehouseRepository.getInventoryItems(warehouseId);
    return items.map((item) => ({
      id: item.id,
      warehouseId: item.warehouseId,
      productId: item.productId,
      sku: item.sku,
      productName: item.productName,
      category: item.category,
      unitOfMeasure: item.unitOfMeasure,
      quantity: item.quantity,
      updatedAt: item.updatedAt.toISOString(),
    }));
  }

  async adjustWarehouseInventory(
    warehouseId: string,
    businessId: string,
    input: AdjustWarehouseInventoryInput,
  ) {
    if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
      throw new BadRequestException('Quantity must be a positive integer.');
    }

    const warehouse = await this.assertWarehouseWithMatrix(warehouseId, businessId);
    const shortStamp = Date.now().toString().slice(-4);
    const randSuffix = Math.random().toString(36).slice(2, 5).toUpperCase();

    if (input.action === 'INSERT') {
      if (typeof input.row !== 'number' || typeof input.col !== 'number') {
        throw new BadRequestException('Select a target storage cell [row, col] for putaway.');
      }

      let resolvedProductId: string | undefined;
      let newProductPayload:
        | {
            businessId: string;
            sku: string;
            name: string;
            category: string;
            unitOfMeasure: string;
          }
        | undefined;

      let resolvedProductEntity: ProductEntity | undefined;
      if (input.newProduct) {
        let draftProduct: ProductEntity;
        try {
          draftProduct = new ProductEntity({
            id: 'draft',
            businessId,
            sku: input.newProduct.sku,
            name: input.newProduct.name,
            category: input.newProduct.category,
            unitOfMeasure: input.newProduct.unitOfMeasure,
          });
        } catch (err) {
          throw new BadRequestException((err as Error).message);
        }

        const existingBySku = await this.warehouseRepository.findProductBySkuAndBusinessId(
          draftProduct.sku,
          businessId,
        );
        if (existingBySku) {
          throw new BadRequestException(
            `SKU ${draftProduct.sku} already exists in your catalog. Select it from the catalog list instead.`,
          );
        }

        newProductPayload = {
          businessId,
          sku: draftProduct.sku,
          name: draftProduct.name,
          category: draftProduct.category,
          unitOfMeasure: draftProduct.unitOfMeasure,
        };
      } else {
        if (!input.productId) {
          throw new BadRequestException('Select a catalog product or enter a new SKU.');
        }
        const existingProduct = await this.warehouseRepository.findProductByIdAndBusinessId(
          input.productId,
          businessId,
        );
        if (!existingProduct) {
          throw new NotFoundException('Selected product does not exist in your business catalog.');
        }
        resolvedProductId = existingProduct.id;
        resolvedProductEntity = existingProduct;
      }

      let updatedCell: StorageLocationEntity;
      try {
        const targetCell = warehouse.getCell(input.row, input.col);
        if (resolvedProductEntity) {
          targetCell.assignOrVerifyProduct({
            productId: resolvedProductEntity.id,
            sku: resolvedProductEntity.sku,
            productName: resolvedProductEntity.name,
          });
        } else if (targetCell.isOccupied && targetCell.product) {
          throw new Error(
            `Cell ${targetCell.code} already holds ${targetCell.product.sku} (${targetCell.product.productName}). Choose an empty cell for a new SKU.`,
          );
        }
        updatedCell = warehouse.addItemsAt(input.row, input.col, input.quantity);
      } catch (err) {
        throw new BadRequestException((err as Error).message);
      }

      let txResult;
      try {
        txResult = await this.warehouseRepository.executeInventoryTransaction({
          warehouse,
          action: 'INSERT',
          quantity: input.quantity,
          updatedCell,
          productId: resolvedProductId,
          newProduct: newProductPayload,
          movement: {
            type: 'INBOUND',
            referenceCode: `PO-${warehouse.code}-${shortStamp}-${randSuffix}`,
            partnerName: input.partnerName?.trim() || 'Inventory Putaway',
            locationCode: updatedCell.code,
            quantity: input.quantity,
          },
        });
      } catch (err) {
        if (err instanceof InventoryConflictError) {
          throw new BadRequestException(err.message);
        }
        throw err;
      }

      const [refreshedWh, updatedInventory] = await Promise.all([
        this.assertWarehouseOwnership(warehouse.id, businessId),
        this.getInventory(warehouse.id, businessId),
      ]);

      const insertedInv = updatedInventory.find((i) => i.sku === txResult.movement.productSku);
      const finalItems = txResult.cellCurrentItems ?? updatedCell.currentItems;
      const cellDto = {
        ...this.serializeCell(updatedCell),
        currentItems: finalItems,
        isOccupied: finalItems > 0,
        product: insertedInv
          ? {
              productId: insertedInv.productId,
              sku: insertedInv.sku,
              productName: insertedInv.productName,
            }
          : updatedCell.product,
      };

      return {
        warehouse: this.serializeWarehouseSummary(refreshedWh),
        cell: cellDto,
        inventory: updatedInventory,
        movement: this.serializeMovement(txResult.movement),
      };
    }

    // REMOVE action
    if (!input.productId) {
      throw new BadRequestException('Select an inventory item to remove.');
    }

    const currentInv = await this.warehouseRepository.findInventoryItem(
      warehouse.id,
      input.productId,
    );
    if (!currentInv) {
      throw new BadRequestException('Selected item is not currently held in this warehouse.');
    }

    try {
      currentInv.adjustQuantity(-input.quantity);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }

    let updatedCell: StorageLocationEntity | null = null;
    if (typeof input.row === 'number' && typeof input.col === 'number') {
      try {
        const targetCell = warehouse.getCell(input.row, input.col);
        targetCell.verifyProductForRemoval(currentInv.productId, currentInv.sku);
        updatedCell = warehouse.removeItemsAt(input.row, input.col, input.quantity);
      } catch (err) {
        throw new BadRequestException((err as Error).message);
      }
    }

    let txResult;
    try {
      txResult = await this.warehouseRepository.executeInventoryTransaction({
        warehouse,
        action: 'REMOVE',
        quantity: input.quantity,
        updatedCell,
        productId: currentInv.productId,
        movement: {
          type: 'OUTBOUND',
          referenceCode: `SO-${warehouse.code}-${shortStamp}-${randSuffix}`,
          partnerName: input.partnerName?.trim() || 'Inventory Pick & Removal',
          locationCode: updatedCell ? updatedCell.code : null,
          quantity: input.quantity,
        },
      });
    } catch (err) {
      if (err instanceof InventoryConflictError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }

    const [refreshedWh, updatedInventory] = await Promise.all([
      this.assertWarehouseOwnership(warehouse.id, businessId),
      this.getInventory(warehouse.id, businessId),
    ]);

    const finalCellItems = txResult.cellCurrentItems ?? updatedCell?.currentItems ?? 0;
    const cellDto = updatedCell
      ? {
          ...this.serializeCell(updatedCell),
          currentItems: finalCellItems,
          isOccupied: finalCellItems > 0,
          product: finalCellItems === 0 ? null : updatedCell.product,
        }
      : null;

    return {
      warehouse: this.serializeWarehouseSummary(refreshedWh),
      cell: cellDto,
      inventory: updatedInventory,
      movement: this.serializeMovement(txResult.movement),
    };
  }

  async getMovements(warehouseId: string, businessId: string, type?: MovementType) {
    await this.assertWarehouseOwnership(warehouseId, businessId);
    const movements = await this.warehouseRepository.getMovements(warehouseId, type, 100);
    return movements.map((m) => this.serializeMovement(m));
  }

  private async assertWarehouseOwnership(
    warehouseId: string,
    businessId: string,
  ): Promise<WarehouseEntity> {
    const warehouse = await this.warehouseRepository.findByIdAndBusinessId(warehouseId, businessId);
    if (!warehouse) {
      throw new NotFoundException('Warehouse not found or does not belong to your business.');
    }
    return warehouse;
  }

  private async assertWarehouseWithMatrix(
    warehouseId: string,
    businessId: string,
  ): Promise<WarehouseEntity> {
    const warehouse = await this.warehouseRepository.findWithMatrixByIdAndBusinessId(
      warehouseId,
      businessId,
    );
    if (!warehouse) {
      throw new NotFoundException('Warehouse not found or does not belong to your business.');
    }
    return warehouse;
  }

  private serializeMovement(m: StockMovementEntity) {
    return {
      id: m.id,
      type: m.movementType,
      referenceCode: m.referenceCode,
      partnerName: m.partnerName,
      productSku: m.productSku,
      productName: m.productName,
      locationCode: m.locationCode,
      quantity: m.quantity,
      status: m.status,
      createdAt: m.createdAt.toISOString(),
    };
  }

  private serializeCell(cell: StorageLocationEntity) {
    return {
      id: cell.id,
      row: cell.row,
      col: cell.col,
      code: cell.code,
      currentItems: cell.currentItems,
      maxUnits: cell.maxUnits,
      isOccupied: cell.isOccupied,
      product: cell.product,
    };
  }

  private serializeWarehouseSummary(warehouse: WarehouseEntity) {
    return {
      id: warehouse.id,
      name: warehouse.name,
      code: warehouse.code,
      city: warehouse.address.city,
      address: warehouse.address.street,
      country: warehouse.address.country,
      type: warehouse.type,
      rows: warehouse.rows,
      cols: warehouse.cols,
      totalCapacity: warehouse.totalCapacity,
      usedCapacity: warehouse.usedCapacity,
      availableCapacity: warehouse.calculateAvailableCapacity(),
      totalItemsCounter: warehouse.totalItemsCounter,
      occupancyPercentage: warehouse.calculateOccupancyPercentage(),
      capacityStatus: warehouse.getCapacityStatus(),
    };
  }
}
