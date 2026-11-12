import { Injectable } from '@nestjs/common';
import { WarehousesService } from '../warehouses/warehouses.service';
import { WarehouseAiContext } from './ai-context.model';
import { AiExecutedAction } from './ai.types';

@Injectable()
export class AiToolExecutorService {
  constructor(private readonly warehousesService: WarehousesService) {}

  async insertInventoryItem(
    ctx: WarehouseAiContext,
    args: {
      skuOrProduct: string;
      quantity: number;
      cellCode?: string;
      partnerName?: string;
    },
  ): Promise<{ ok: boolean; message: string; executed?: AiExecutedAction }> {
    const qty = Math.round(Number(args.quantity));
    if (!Number.isFinite(qty) || qty <= 0) {
      return { ok: false, message: 'Quantity must be a positive whole number.' };
    }

    const matchedProduct = ctx.matchCatalogProduct(args.skuOrProduct);
    if (!matchedProduct) {
      return {
        ok: false,
        message: `Could not find "${args.skuOrProduct}" in your business product catalog. Available SKUs: ${ctx.catalog.map((c) => c.sku).join(', ')}.`,
      };
    }

    const targetCell = args.cellCode
      ? ctx.findCellByCode(args.cellCode)
      : ctx.findFirstCellForInsert(qty, matchedProduct.id);

    if (!targetCell) {
      return {
        ok: false,
        message: args.cellCode
          ? `Cell "${args.cellCode}" does not exist in ${ctx.dashboard.warehouse.code}.`
          : `No cell in ${ctx.dashboard.warehouse.code} has enough free capacity for ${qty} items.`,
      };
    }

    try {
      const res = await this.warehousesService.adjustWarehouseInventory(
        ctx.dashboard.warehouse.id,
        ctx.businessId,
        {
          action: 'INSERT',
          productId: matchedProduct.id,
          quantity: qty,
          row: targetCell.row,
          col: targetCell.col,
          partnerName: args.partnerName || 'Helper Boxiy Putaway',
        },
      );

      const summary = `Inserted ${qty} × ${matchedProduct.sku} (${matchedProduct.name}) into cell ${targetCell.code}. Warehouse is now ${res.warehouse.occupancyPercentage}% full.`;
      return {
        ok: true,
        message: summary,
        executed: {
          summary,
          cellCode: targetCell.code,
          sku: matchedProduct.sku,
          quantity: qty,
          direction: 'INBOUND',
        },
      };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }

  async removeInventoryItem(
    ctx: WarehouseAiContext,
    args: {
      skuOrProduct: string;
      quantity: number;
      cellCode?: string;
      partnerName?: string;
    },
  ): Promise<{ ok: boolean; message: string; executed?: AiExecutedAction }> {
    const qty = Math.round(Number(args.quantity));
    if (!Number.isFinite(qty) || qty <= 0) {
      return { ok: false, message: 'Quantity must be a positive whole number.' };
    }

    const matchedInv = ctx.matchInventoryItem(args.skuOrProduct);
    if (!matchedInv) {
      return {
        ok: false,
        message: `"${args.skuOrProduct}" is not currently in ${ctx.dashboard.warehouse.name} inventory.`,
      };
    }

    let targetCell = args.cellCode ? ctx.findCellByCode(args.cellCode) : null;
    if (args.cellCode && !targetCell) {
      return {
        ok: false,
        message: `Cell "${args.cellCode}" does not exist in ${ctx.dashboard.warehouse.code}.`,
      };
    }
    if (!args.cellCode) {
      targetCell = ctx.findFirstCellForRemove(qty, matchedInv.productId);
    }

    try {
      const res = await this.warehousesService.adjustWarehouseInventory(
        ctx.dashboard.warehouse.id,
        ctx.businessId,
        {
          action: 'REMOVE',
          productId: matchedInv.productId,
          quantity: qty,
          row: targetCell ? targetCell.row : undefined,
          col: targetCell ? targetCell.col : undefined,
          partnerName: args.partnerName || 'Helper Boxiy Pick',
        },
      );

      const cellPhrase = targetCell ? ` from cell ${targetCell.code}` : '';
      const summary = `Removed ${qty} × ${matchedInv.sku} (${matchedInv.productName})${cellPhrase}. Warehouse is now ${res.warehouse.occupancyPercentage}% full.`;
      return {
        ok: true,
        message: summary,
        executed: {
          summary,
          cellCode: targetCell?.code ?? null,
          sku: matchedInv.sku,
          quantity: qty,
          direction: 'OUTBOUND',
        },
      };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }

  async adjustMatrixCellCounter(
    ctx: WarehouseAiContext,
    args: {
      cellCode: string;
      delta: number;
    },
  ): Promise<{ ok: boolean; message: string; executed?: AiExecutedAction }> {
    const delta = Math.round(Number(args.delta));
    if (!Number.isFinite(delta) || delta === 0) {
      return { ok: false, message: 'Cell delta must be a non-zero integer.' };
    }

    const cell = ctx.findCellByCode(args.cellCode);
    if (!cell) {
      return {
        ok: false,
        message: `Cell "${args.cellCode}" was not found in ${ctx.dashboard.warehouse.code}.`,
      };
    }

    try {
      const res = await this.warehousesService.adjustMatrixCellItems(
        ctx.dashboard.warehouse.id,
        ctx.businessId,
        cell.row,
        cell.col,
        delta,
      );

      const verb = delta > 0 ? `Added ${delta}` : `Removed ${Math.abs(delta)}`;
      const summary = `${verb} unit(s) in cell ${res.cell.code} (now ${res.cell.currentItems}/${res.cell.maxUnits}). Warehouse is ${res.warehouse.occupancyPercentage}% full.`;
      return {
        ok: true,
        message: summary,
        executed: {
          summary,
          cellCode: res.cell.code,
          quantity: Math.abs(delta),
          direction: 'CELL_ADJUST',
        },
      };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }
}
