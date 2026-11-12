import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import {
  InventoryConflictError,
  InventoryTransactionCommand,
  InventoryTransactionResult,
  IWarehouseRepository,
  WarehouseMetricsSnapshot,
} from '../../domain/repositories/warehouse.repository.interface';
import { WarehouseEntity, WarehouseType } from '../../domain/entities/warehouse.entity';
import { Address } from '../../domain/value-objects/address.value-object';
import { StorageLocationEntity } from '../../domain/entities/storage-location.entity';
import { ItemInventoryEntity } from '../../domain/entities/item-inventory.entity';
import { ProductEntity } from '../../domain/entities/product.entity';
import {
  InboundMovementEntity,
  MovementStatus,
  MovementType,
  OutboundMovementEntity,
  StockMovementEntity,
} from '../../domain/entities/stock-movement.entity';

@Injectable()
export class PrismaWarehouseRepository implements IWarehouseRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAllByBusinessId(businessId: string): Promise<WarehouseEntity[]> {
    const records = await this.prisma.warehouse.findMany({
      where: { businessId },
      orderBy: { createdAt: 'asc' },
    });

    return records.map((wh) => this.toWarehouseDomain(wh));
  }

  async findByIdAndBusinessId(
    warehouseId: string,
    businessId: string,
  ): Promise<WarehouseEntity | null> {
    const wh = await this.prisma.warehouse.findFirst({
      where: { id: warehouseId, businessId },
    });

    if (!wh) return null;
    return this.toWarehouseDomain(wh);
  }

  async findWithMatrixByIdAndBusinessId(
    warehouseId: string,
    businessId: string,
  ): Promise<WarehouseEntity | null> {
    const wh = await this.prisma.warehouse.findFirst({
      where: { id: warehouseId, businessId },
      include: {
        locations: {
          include: {
            product: true,
          },
          orderBy: [{ row: 'asc' }, { col: 'asc' }],
        },
      },
    });

    if (!wh) return null;

    // Build rows x cols 2D Matrix of StorageLocationEntity instances
    const matrix: StorageLocationEntity[][] = Array.from({ length: wh.rows }, () => []);

    for (const loc of wh.locations) {
      if (loc.row >= 0 && loc.row < wh.rows && loc.col >= 0 && loc.col < wh.cols) {
        matrix[loc.row][loc.col] = new StorageLocationEntity({
          id: loc.id,
          warehouseId: loc.warehouseId,
          row: loc.row,
          col: loc.col,
          code: loc.code,
          currentItems: loc.currentItems,
          maxUnits: loc.maxUnits,
          product: loc.product
            ? {
                productId: loc.product.id,
                sku: loc.product.sku,
                productName: loc.product.name,
              }
            : null,
          createdAt: loc.createdAt,
          updatedAt: loc.updatedAt,
        });
      }
    }

    return new WarehouseEntity({
      id: wh.id,
      businessId: wh.businessId,
      name: wh.name,
      code: wh.code,
      address: new Address({
        city: wh.city,
        street: wh.street,
        country: wh.country,
      }),
      type: wh.type as WarehouseType,
      rows: wh.rows,
      cols: wh.cols,
      matrix,
      createdAt: wh.createdAt,
      updatedAt: wh.updatedAt,
    });
  }

  async saveCellAndWarehouseCounters(
    warehouse: WarehouseEntity,
    cell: StorageLocationEntity,
    delta: number,
  ): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        if (delta > 0) {
          const updated = await tx.storageLocation.updateMany({
            where: {
              id: cell.id,
              isOccupied: true,
              productId: { not: null },
              currentItems: { gt: 0, lte: cell.maxUnits - delta },
            },
            data: {
              currentItems: { increment: delta },
            },
          });
          if (updated.count === 0) {
            throw new InventoryConflictError(
              `Cannot add ${delta} items to cell ${cell.code} (cell is empty or exceeds max capacity ${cell.maxUnits}).`,
            );
          }
          await tx.warehouse.update({
            where: { id: warehouse.id },
            data: { totalItems: { increment: delta } },
          });
        } else {
          const absDelta = Math.abs(delta);
          const drained = await tx.storageLocation.updateMany({
            where: { id: cell.id, currentItems: absDelta },
            data: { currentItems: 0, isOccupied: false, productId: null },
          });
          let usedCapDelta = 0;
          if (drained.count === 1) {
            usedCapDelta = -1;
          } else {
            const partial = await tx.storageLocation.updateMany({
              where: { id: cell.id, currentItems: { gt: absDelta } },
              data: { currentItems: { decrement: absDelta } },
            });
            if (partial.count === 0) {
              throw new InventoryConflictError(
                `Cannot remove ${absDelta} items from cell ${cell.code} (insufficient items in cell).`,
              );
            }
          }
          await tx.warehouse.update({
            where: { id: warehouse.id },
            data: {
              usedCapacity: { increment: usedCapDelta },
              totalItems: { decrement: absDelta },
            },
          });
        }
      },
      { maxWait: 20000, timeout: 25000 },
    );
  }

  async getWarehouseMetrics(warehouseId: string): Promise<WarehouseMetricsSnapshot> {
    const [inventoryRows, pendingInboundCount, pendingOutboundCount] = await Promise.all([
      this.prisma.itemInventory.findMany({
        where: { warehouseId },
        select: { productId: true, quantity: true },
      }),
      this.prisma.stockMovement.count({
        where: {
          warehouseId,
          type: 'INBOUND',
          status: { in: ['PENDING', 'IN_PROGRESS'] },
        },
      }),
      this.prisma.stockMovement.count({
        where: {
          warehouseId,
          type: 'OUTBOUND',
          status: { in: ['PENDING', 'IN_PROGRESS'] },
        },
      }),
    ]);

    const totalUnitsInStock = inventoryRows.reduce((sum, r) => sum + r.quantity, 0);

    return {
      totalSkusStored: inventoryRows.length,
      totalUnitsInStock,
      pendingInboundCount,
      pendingOutboundCount,
    };
  }

  async getInventoryItems(warehouseId: string): Promise<ItemInventoryEntity[]> {
    const items = await this.prisma.itemInventory.findMany({
      where: { warehouseId },
      include: {
        product: true,
      },
      orderBy: [{ product: { sku: 'asc' } }],
    });

    return items.map(
      (item) =>
        new ItemInventoryEntity({
          id: item.id,
          warehouseId: item.warehouseId,
          productId: item.productId,
          sku: item.product.sku,
          productName: item.product.name,
          category: item.product.category,
          unitOfMeasure: item.product.unitOfMeasure,
          quantity: item.quantity,
          updatedAt: item.updatedAt,
        }),
    );
  }

  async findInventoryItem(
    warehouseId: string,
    productId: string,
  ): Promise<ItemInventoryEntity | null> {
    const item = await this.prisma.itemInventory.findUnique({
      where: {
        warehouseId_productId: {
          warehouseId,
          productId,
        },
      },
      include: {
        product: true,
      },
    });

    if (!item) return null;

    return new ItemInventoryEntity({
      id: item.id,
      warehouseId: item.warehouseId,
      productId: item.productId,
      sku: item.product.sku,
      productName: item.product.name,
      category: item.product.category,
      unitOfMeasure: item.product.unitOfMeasure,
      quantity: item.quantity,
      updatedAt: item.updatedAt,
    });
  }

  async getBusinessProducts(businessId: string): Promise<ProductEntity[]> {
    const rows = await this.prisma.product.findMany({
      where: { businessId },
      orderBy: { sku: 'asc' },
    });

    return rows.map(
      (p) =>
        new ProductEntity({
          id: p.id,
          businessId: p.businessId,
          sku: p.sku,
          name: p.name,
          category: p.category,
          unitOfMeasure: p.unitOfMeasure,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
        }),
    );
  }

  async findProductByIdAndBusinessId(
    productId: string,
    businessId: string,
  ): Promise<ProductEntity | null> {
    const p = await this.prisma.product.findFirst({
      where: { id: productId, businessId },
    });
    if (!p) return null;
    return new ProductEntity({
      id: p.id,
      businessId: p.businessId,
      sku: p.sku,
      name: p.name,
      category: p.category,
      unitOfMeasure: p.unitOfMeasure,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    });
  }

  async findProductBySkuAndBusinessId(
    sku: string,
    businessId: string,
  ): Promise<ProductEntity | null> {
    const p = await this.prisma.product.findUnique({
      where: {
        businessId_sku: {
          businessId,
          sku: sku.trim().toUpperCase(),
        },
      },
    });
    if (!p) return null;
    return new ProductEntity({
      id: p.id,
      businessId: p.businessId,
      sku: p.sku,
      name: p.name,
      category: p.category,
      unitOfMeasure: p.unitOfMeasure,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    });
  }

  async executeInventoryTransaction(
    cmd: InventoryTransactionCommand,
  ): Promise<InventoryTransactionResult> {
    const qty = cmd.quantity;

    return this.prisma.$transaction(
      async (tx) => {
        let resolvedProductId = cmd.productId;

        if (cmd.newProduct) {
          const existingSku = await tx.product.findFirst({
            where: {
              businessId: cmd.newProduct.businessId,
              sku: { equals: cmd.newProduct.sku, mode: 'insensitive' },
            },
          });
          if (existingSku) {
            throw new InventoryConflictError(
              `SKU ${cmd.newProduct.sku} already exists in your catalog.`,
            );
          }

          const createdProduct = await tx.product.create({
            data: {
              businessId: cmd.newProduct.businessId,
              sku: cmd.newProduct.sku,
              name: cmd.newProduct.name,
              category: cmd.newProduct.category,
              unitOfMeasure: cmd.newProduct.unitOfMeasure,
            },
          });
          resolvedProductId = createdProduct.id;
        }

        if (!resolvedProductId) {
          throw new InventoryConflictError('A target product is required for inventory transactions.');
        }

        let usedCapacityDelta = 0;
        let totalItemsDelta = 0;
        let cellCurrentItems: number | null = null;

        // 1. Atomic StorageLocation row-level claim/update FIRST (rejects cell races immediately)
        if (cmd.updatedCell) {
          const cellId = cmd.updatedCell.id;
          const maxUnits = cmd.updatedCell.maxUnits;

          if (cmd.action === 'INSERT') {
            // Case A: Cell already holds this exact product and has space
            const sameSkuUpdate = await tx.storageLocation.updateMany({
              where: {
                id: cellId,
                warehouseId: cmd.warehouse.id,
                currentItems: { gt: 0, lte: maxUnits - qty },
                productId: resolvedProductId,
              },
              data: {
                currentItems: { increment: qty },
                isOccupied: true,
              },
            });

            if (sameSkuUpdate.count === 1) {
              usedCapacityDelta = 0;
              totalItemsDelta = qty;
            } else {
              // Case B: Claim an empty cell (0 items) atomically
              const claimEmpty =
                qty <= maxUnits
                  ? await tx.storageLocation.updateMany({
                      where: {
                        id: cellId,
                        warehouseId: cmd.warehouse.id,
                        currentItems: 0,
                      },
                      data: {
                        currentItems: qty,
                        isOccupied: true,
                        productId: resolvedProductId,
                      },
                    })
                  : { count: 0 };

              if (claimEmpty.count === 1) {
                usedCapacityDelta = 1;
                totalItemsDelta = qty;
              } else {
                const liveCell = await tx.storageLocation.findUnique({
                  where: { id: cellId },
                  include: { product: true },
                });
                if (
                  liveCell?.product &&
                  liveCell.currentItems > 0 &&
                  liveCell.productId !== resolvedProductId
                ) {
                  throw new InventoryConflictError(
                    `Cell ${cmd.updatedCell.code} already holds ${liveCell.product.sku} (${liveCell.product.name}). Choose an empty cell or a cell holding the same SKU.`,
                  );
                }
                throw new InventoryConflictError(
                  `Cell ${cmd.updatedCell.code} does not have enough free capacity for ${qty} items (currently ${liveCell?.currentItems ?? 0}/${maxUnits}).`,
                );
              }
            }
          } else {
            // REMOVE from specific cell
            const drainToZero = await tx.storageLocation.updateMany({
              where: {
                id: cellId,
                warehouseId: cmd.warehouse.id,
                productId: resolvedProductId,
                currentItems: qty,
              },
              data: {
                currentItems: 0,
                isOccupied: false,
                productId: null,
              },
            });

            if (drainToZero.count === 1) {
              usedCapacityDelta = -1;
              totalItemsDelta = -qty;
            } else {
              const partialPick = await tx.storageLocation.updateMany({
                where: {
                  id: cellId,
                  warehouseId: cmd.warehouse.id,
                  productId: resolvedProductId,
                  currentItems: { gt: qty },
                },
                data: {
                  currentItems: { decrement: qty },
                },
              });

              if (partialPick.count === 1) {
                usedCapacityDelta = 0;
                totalItemsDelta = -qty;
              } else {
                const liveCell = await tx.storageLocation.findUnique({
                  where: { id: cellId },
                  include: { product: true },
                });
                if (!liveCell || liveCell.currentItems === 0) {
                  throw new InventoryConflictError(
                    `Cell ${cmd.updatedCell.code} is already empty (0 items).`,
                  );
                }
                if (liveCell.productId !== resolvedProductId) {
                  throw new InventoryConflictError(
                    `Cell ${cmd.updatedCell.code} holds ${liveCell.product?.sku ?? 'another SKU'}, not the selected item.`,
                  );
                }
                throw new InventoryConflictError(
                  `Cannot remove ${qty} items from cell ${cmd.updatedCell.code} (only ${liveCell.currentItems} available).`,
                );
              }
            }
          }

          const refreshedCell = await tx.storageLocation.findUnique({
            where: { id: cellId },
            select: { currentItems: true },
          });
          cellCurrentItems = refreshedCell?.currentItems ?? null;
        }

        // 2. Atomic ItemInventory increment / decrement (concurrency-safe against P2002 & Lost Updates)
        if (cmd.action === 'INSERT') {
          const incExisting = await tx.itemInventory.updateMany({
            where: {
              warehouseId: cmd.warehouse.id,
              productId: resolvedProductId,
            },
            data: {
              quantity: { increment: qty },
            },
          });

          if (incExisting.count === 0) {
            try {
              await tx.itemInventory.create({
                data: {
                  warehouseId: cmd.warehouse.id,
                  productId: resolvedProductId,
                  quantity: qty,
                },
              });
            } catch {
              // Concurrent worker inserted the row milliseconds earlier; increment atomically
              await tx.itemInventory.updateMany({
                where: {
                  warehouseId: cmd.warehouse.id,
                  productId: resolvedProductId,
                },
                data: {
                  quantity: { increment: qty },
                },
              });
            }
          }
        } else {
          const decInv = await tx.itemInventory.updateMany({
            where: {
              warehouseId: cmd.warehouse.id,
              productId: resolvedProductId,
              quantity: { gte: qty },
            },
            data: {
              quantity: { decrement: qty },
            },
          });
          if (decInv.count === 0) {
            throw new InventoryConflictError(
              `Insufficient warehouse stock to remove ${qty} unit(s).`,
            );
          }
          await tx.itemInventory.deleteMany({
            where: {
              warehouseId: cmd.warehouse.id,
              productId: resolvedProductId,
              quantity: { lte: 0 },
            },
          });
        }

        // 3. Atomic Warehouse summary counter update
        let updatedWh = {
          usedCapacity: cmd.warehouse.usedCapacity,
          totalItems: cmd.warehouse.totalItemsCounter,
        };
        if (cmd.updatedCell) {
          updatedWh = await tx.warehouse.update({
            where: { id: cmd.warehouse.id },
            data: {
              usedCapacity: { increment: usedCapacityDelta },
              totalItems: { increment: totalItemsDelta },
            },
            select: {
              usedCapacity: true,
              totalItems: true,
            },
          });
        }

        // 4. Record StockMovement ledger entry
        const m = await tx.stockMovement.create({
          data: {
            warehouseId: cmd.warehouse.id,
            productId: resolvedProductId,
            type: cmd.movement.type,
            referenceCode: cmd.movement.referenceCode,
            partnerName: cmd.movement.partnerName,
            locationCode: cmd.movement.locationCode,
            quantity: cmd.movement.quantity,
            status: 'COMPLETED',
          },
          include: {
            product: true,
          },
        });

        const props = {
          id: m.id,
          warehouseId: m.warehouseId,
          productSku: m.product.sku,
          productName: m.product.name,
          referenceCode: m.referenceCode,
          partnerName: m.partnerName,
          locationCode: m.locationCode,
          quantity: m.quantity,
          status: m.status as MovementStatus,
          createdAt: m.createdAt,
        };

        const movementEntity =
          m.type === 'INBOUND'
            ? new InboundMovementEntity(props)
            : new OutboundMovementEntity(props);

        return {
          movement: movementEntity,
          warehouseUsedCapacity: updatedWh.usedCapacity,
          warehouseTotalItems: updatedWh.totalItems,
          cellCurrentItems,
        };
      },
      { maxWait: 20000, timeout: 25000 },
    );
  }

  async getMovements(
    warehouseId: string,
    type?: MovementType,
    limit = 50,
  ): Promise<StockMovementEntity[]> {
    const movements = await this.prisma.stockMovement.findMany({
      where: {
        warehouseId,
        ...(type ? { type } : {}),
      },
      include: { product: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return movements.map((m) => {
      const props = {
        id: m.id,
        warehouseId: m.warehouseId,
        productSku: m.product.sku,
        productName: m.product.name,
        referenceCode: m.referenceCode,
        partnerName: m.partnerName,
        locationCode: m.locationCode,
        quantity: m.quantity,
        status: m.status as MovementStatus,
        createdAt: m.createdAt,
      };
      return m.type === 'INBOUND'
        ? new InboundMovementEntity(props)
        : new OutboundMovementEntity(props);
    });
  }

  private toWarehouseDomain(wh: {
    id: string;
    businessId: string;
    name: string;
    code: string;
    city: string;
    street: string;
    country: string | null;
    type: string;
    rows: number;
    cols: number;
    usedCapacity: number;
    totalItems: number;
    createdAt: Date;
    updatedAt: Date;
  }): WarehouseEntity {
    return new WarehouseEntity({
      id: wh.id,
      businessId: wh.businessId,
      name: wh.name,
      code: wh.code,
      address: new Address({
        city: wh.city,
        street: wh.street,
        country: wh.country,
      }),
      type: wh.type as WarehouseType,
      rows: wh.rows,
      cols: wh.cols,
      usedCapacitySnapshot: wh.usedCapacity,
      totalItemsSnapshot: wh.totalItems,
      createdAt: wh.createdAt,
      updatedAt: wh.updatedAt,
    });
  }
}
