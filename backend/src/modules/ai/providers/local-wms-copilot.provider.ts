import { Injectable } from '@nestjs/common';
import { WarehouseAiContext } from '../ai-context.model';
import { AiToolExecutorService } from '../ai-tool-executor.service';
import { AiChatMessage, AiExecutedAction } from '../ai.types';
import { AiCopilotProvider, CopilotTurnResult } from './ai-copilot.provider';

/**
 * Grounded WMS Copilot engine backed directly by live Neon PostgreSQL warehouse data.
 * Answers strictly from available warehouse records and explicitly abstains when asked
 * about unsupported or out-of-scope information.
 */
@Injectable()
export class LocalWmsCopilotProvider extends AiCopilotProvider {
  public readonly providerName = 'LOCAL_WMS_ENGINE' as const;

  constructor(private readonly toolExecutor: AiToolExecutorService) {
    super();
  }

  public isConfigured(): boolean {
    return true;
  }

  public async generateReply(
    ctx: WarehouseAiContext,
    userMessage: string,
    _history: AiChatMessage[],
  ): Promise<CopilotTurnResult> {
    const text = userMessage.trim();
    const lower = text.toLowerCase();
    const wh = ctx.dashboard.warehouse;
    const executedActions: AiExecutedAction[] = [];

    // 0. Explicit unsupported warehouse attributes (price, cost, weight, expiry, salary, weather — English & Hebrew)
    if (
      /\b(price|prices|cost|costs|worth|dollar|shekel|nis|usd|salary|weather|temperature|weight|kg|dimensions|barcode|expiration|expiry)\b/i.test(
        lower,
      ) ||
      /(מחיר|מחירים|עלות|דולר|שקל|שקלים|משכורת|מזג\s*אוויר|טמפרטורה|משקל|קילו|ברקוד|תוקף)/.test(
        text,
      )
    ) {
      return {
        reply: `I cannot answer that yet — that information is not stored in ${wh.name} (${wh.code}) warehouse data. I can answer questions about cell locations, SKU stock quantities, matrix capacity, and inbound/outbound movements.`,
        provider: 'LOCAL_WMS_ENGINE',
        executedActions,
      };
    }

    // 1. Detect INSERT / REMOVE action commands (English & Hebrew verbs)
    const isInsertIntent =
      /\b(insert|add|put|store|receive|putaway)\b/i.test(lower) ||
      /(תוסיף|הוסף|להוסיף|תכניס|הכנס|להכניס|לקלוט|קלוט)/.test(text);
    const isRemoveIntent =
      /\b(remove|delete|pick|take|deduct|withdraw|dispatch)\b/i.test(lower) ||
      /(תסיר|הסר|להסיר|תוציא|הוצא|להוציא|תמחק|מחק|ללקט)/.test(text);

    // Match cell code even when prefixed by Hebrew prepositions (e.g. בתאA-02 / לתא A-01)
    const cellMatch = text.match(/(?:^|[\s"'(בלהמ])([A-Za-z]-?\d{1,2})(?=$|[\s"'?!.,;:)\]])/);
    const extractedCellCode =
      cellMatch && ctx.findCellByCode(cellMatch[1]) ? cellMatch[1].toUpperCase() : undefined;

    const textWithoutCell = extractedCellCode
      ? text.replace(new RegExp(cellMatch![1], 'i'), ' ')
      : text;

    // Explicit guard against negative or zero quantities on action commands (e.g. "Insert -5 APX-SCN-400")
    if (isInsertIntent || isRemoveIntent) {
      const negMatch = textWithoutCell.match(/(?<![A-Za-z0-9])(-\d{1,6})(?![A-Za-z0-9-])/);
      const zeroMatch = textWithoutCell.match(/(?<![A-Za-z0-9-])(0)(?![A-Za-z0-9-])/);
      if (negMatch || zeroMatch) {
        const badVal = negMatch ? negMatch[1] : '0';
        return {
          reply: `Invalid quantity (${badVal}): quantity must be a positive whole number greater than 0. No changes were made.`,
          provider: 'LOCAL_WMS_ENGINE',
          executedActions,
        };
      }
    }

    // Match standalone positive integer quantities only (never digits attached to SKU hyphens like APX-SCN-400)
    const qtyMatch = textWithoutCell.match(/(?<![A-Za-z0-9-])(\d{1,4})(?![A-Za-z0-9-])/);
    const extractedQty = qtyMatch ? Number(qtyMatch[1]) : null;

    if (isInsertIntent && extractedQty !== null) {
      const cleanedQuery = textWithoutCell
        .replace(
          /\b(insert|add|put|store|receive|putaway|into|in|to|cell|units|items|of|first|open)\b/gi,
          ' ',
        )
        .replace(/(תוסיף|הוסף|להוסיף|תכניס|הכנס|להכניס|לקלוט|קלוט|לתא|בתא|תא|יחידות|פריטים)/g, ' ')
        .replace(/(?<![A-Za-z0-9-])\d{1,4}(?![A-Za-z0-9-])/g, ' ')
        .trim();

      const res = await this.toolExecutor.insertInventoryItem(ctx, {
        skuOrProduct: cleanedQuery || ctx.catalog[0]?.sku || '',
        quantity: extractedQty,
        cellCode: extractedCellCode,
      });

      if (res.executed) executedActions.push(res.executed);
      return {
        reply: res.message,
        provider: 'LOCAL_WMS_ENGINE',
        executedActions,
      };
    }

    if (isRemoveIntent && extractedQty !== null) {
      const cleanedQuery = textWithoutCell
        .replace(
          /\b(remove|delete|pick|take|deduct|withdraw|dispatch|from|out|of|cell|inventory|units|items)\b/gi,
          ' ',
        )
        .replace(/(תסיר|הסר|להסיר|תוציא|הוצא|להוציא|תמחק|מחק|ללקט|מתא|בתא|תא|יחידות|פריטים)/g, ' ')
        .replace(/(?<![A-Za-z0-9-])\d{1,4}(?![A-Za-z0-9-])/g, ' ')
        .trim();

      const res = await this.toolExecutor.removeInventoryItem(ctx, {
        skuOrProduct: cleanedQuery || ctx.inventory[0]?.sku || '',
        quantity: extractedQty,
        cellCode: extractedCellCode,
      });

      if (res.executed) executedActions.push(res.executed);
      return {
        reply: res.message,
        provider: 'LOCAL_WMS_ENGINE',
        executedActions,
      };
    }

    // 2. Specific Cell Inspection (e.g. "What is in A-01?" or "Status of cell G-05")
    if (extractedCellCode) {
      const cell = ctx.findCellByCode(extractedCellCode);
      if (cell) {
        const remaining = cell.maxUnits - cell.currentItems;
        const productNote = cell.product
          ? `holding ${cell.product.sku} (${cell.product.productName})`
          : 'empty (no product assigned)';
        return {
          reply: `Cell ${cell.code} [row ${cell.row}, col ${cell.col}] is ${
            cell.isOccupied ? 'occupied' : 'open'
          } (${cell.currentItems}/${cell.maxUnits} items, ${remaining} free slots), ${productNote}.`,
          provider: 'LOCAL_WMS_ENGINE',
          executedActions,
        };
      }
    }

    // 3. Specific Row Inspection (e.g. "How full is Row B?" / "שורה B")
    const rowMatch = text.match(/(?:\brow|שורה)\s+([a-zA-Z])\b/i);
    if (rowMatch) {
      const letter = rowMatch[1].toUpperCase();
      const rowInfo = ctx.dashboard.rowBreakdown.find(
        (r) => r.rowLabel.toUpperCase() === `ROW ${letter}`,
      );
      if (!rowInfo) {
        return {
          reply: `Row ${letter} does not exist in ${wh.name} (${wh.code} only has Row A through Row ${String.fromCharCode(64 + wh.rows)}).`,
          provider: 'LOCAL_WMS_ENGINE',
          executedActions,
        };
      }
      return {
        reply: `${rowInfo.rowLabel} in ${wh.name}: ${rowInfo.usedPlaces}/${rowInfo.totalPlaces} cells occupied (${rowInfo.occupancyPercentage}% full), holding ${rowInfo.totalItemsInRow} total items.`,
        provider: 'LOCAL_WMS_ENGINE',
        executedActions,
      };
    }

    // 4. Open / Empty Cells Request (English & Hebrew)
    const isExplicitOpenCellsQuery =
      /\b(open|empty|free|available|unused)\s+(cell|cells|location|locations|slot|slots|space|places)\b/i.test(
        lower,
      ) ||
      /\brecommend\s+open\s+cells\b/i.test(lower) ||
      /(תאים\s+(פנויים|ריקים)|מקום\s+פנוי|מקומות\s+פנויים)/.test(text);

    if (isExplicitOpenCellsQuery) {
      const openList = ctx.openCells.slice(0, 10).map((c) => c.code);
      const bestRows = [...ctx.dashboard.rowBreakdown]
        .sort((a, b) => a.occupancyPercentage - b.occupancyPercentage)
        .slice(0, 3)
        .map((r) => `${r.rowLabel} (${r.occupancyPercentage}% full)`);

      if (ctx.openCells.length === 0) {
        return {
          reply: `All ${wh.totalCapacity} cells in ${wh.name} (${wh.occupancyPercentage}% full) currently hold at least 1 item (0 completely empty cells).`,
          provider: 'LOCAL_WMS_ENGINE',
          executedActions,
        };
      }

      return {
        reply: [
          `${wh.name} (${wh.code}) is ${wh.occupancyPercentage}% full (${wh.usedCapacity}/${wh.totalCapacity} occupied) and has ${ctx.openCells.length} empty cells.`,
          `Open cells: ${openList.join(', ')}${ctx.openCells.length > 10 ? ` (+${ctx.openCells.length - 10} more)` : ''}.`,
          `Lowest-load rows: ${bestRows.join(', ')}.`,
        ].join('\n'),
        provider: 'LOCAL_WMS_ENGINE',
        executedActions,
      };
    }

    // 5. Product / Item Lookup & Variant Disambiguation (e.g. "cables", "10 meter cable", "sensors")
    const allInvMatches = ctx.matchAllInventoryItems(text);
    const allCatMatches = allInvMatches.length > 0 ? [] : ctx.matchAllCatalogProducts(text);

    // If multiple product variants match (e.g. 10-meter vs 23-meter cable), disambiguate!
    if (allInvMatches.length > 1) {
      const lines = allInvMatches.map((item, idx) => {
        const cells = ctx.getCellsForProduct(item.productId);
        const cellCodes = cells.map((c) => `${c.code} (${c.currentItems} units)`).join(', ');
        return `${idx + 1}. **${item.productName}** (${item.sku}): ${item.quantity.toLocaleString()} ${item.unitOfMeasure} [${cellCodes || 'no cells'}]`;
      });
      return {
        reply: [
          `I found ${allInvMatches.length} matching product variants in ${wh.name}:`,
          ...lines,
          `Which length or variant would you like to inspect or adjust?`,
        ].join('\n'),
        provider: 'LOCAL_WMS_ENGINE',
        executedActions,
      };
    }

    if (allCatMatches.length > 1) {
      const lines = allCatMatches.map(
        (p, idx) => `${idx + 1}. **${p.name}** (${p.sku}) [${p.category}]`,
      );
      return {
        reply: [
          `I found ${allCatMatches.length} matching catalog products:`,
          ...lines,
          `Which specific variant are you looking for?`,
        ].join('\n'),
        provider: 'LOCAL_WMS_ENGINE',
        executedActions,
      };
    }

    const matchedInv = allInvMatches[0] ?? ctx.matchInventoryItem(text);
    const matchedCatalog = matchedInv ? null : (allCatMatches[0] ?? ctx.matchCatalogProduct(text));

    if (matchedInv) {
      const holdingCells = ctx.getCellsForProduct(matchedInv.productId);
      const cellSummary =
        holdingCells.length > 0
          ? holdingCells.map((c) => `${c.code} (${c.currentItems} units)`).join(', ')
          : 'no matrix cells currently assigned';

      return {
        reply: [
          `${matchedInv.productName} (${matchedInv.sku}):`,
          `• Warehouse stock: ${matchedInv.quantity.toLocaleString()} ${matchedInv.unitOfMeasure} (${matchedInv.category})`,
          `• Stored in ${holdingCells.length} cell(s) in ${wh.code}: ${cellSummary}`,
        ].join('\n'),
        provider: 'LOCAL_WMS_ENGINE',
        executedActions,
      };
    }

    if (matchedCatalog) {
      return {
        reply: `${matchedCatalog.name} (${matchedCatalog.sku}) is in your business catalog, with 0 ${matchedCatalog.unitOfMeasure} currently stored in ${wh.name} (${wh.code}).`,
        provider: 'LOCAL_WMS_ENGINE',
        executedActions,
      };
    }

    // 6. Full Inventory List Request (English & Hebrew, with no unmatched product terms)
    const generalListNoise = new Set(['list', 'all', 'current', 'catalog', 'רשימת', 'כל', 'הצג']);
    const unmatchedSpecificTerms = ctx
      .extractCandidateTerms(text)
      .filter((t) => !generalListNoise.has(t));

    if (
      unmatchedSpecificTerms.length === 0 &&
      (/\b(list|all|current|what|show)\b.*\b(stock|inventory|skus|products|catalog)\b/i.test(lower) ||
        /^(inventory|stock|skus|catalog)\??$/i.test(lower) ||
        /(רשימת\s+מלאי|כל\s+המלאי|מה\s+המלאי|מה\s+יש\s+במלאי|הצג\s+מלאי)/.test(text))
    ) {
      if (ctx.inventory.length === 0) {
        return {
          reply: `${wh.name} currently holds 0 SKUs in inventory.`,
          provider: 'LOCAL_WMS_ENGINE',
          executedActions,
        };
      }

      const lines = ctx.inventory.map((i) => {
        const cellCodes = ctx.getCellsForProduct(i.productId).map((c) => c.code);
        return `• ${i.sku} — ${i.productName}: ${i.quantity.toLocaleString()} ${i.unitOfMeasure} (cells: ${cellCodes.slice(0, 5).join(', ')}${cellCodes.length > 5 ? ` +${cellCodes.length - 5} more` : ''})`;
      });
      return {
        reply: [
          `Current inventory in ${wh.name} (${ctx.inventory.length} SKUs, ${ctx.dashboard.metrics.totalUnitsInStock.toLocaleString()} total units):`,
          ...lines,
        ].join('\n'),
        provider: 'LOCAL_WMS_ENGINE',
        executedActions,
      };
    }

    // 7. Inbound / Outbound Dock Movements (English & Hebrew)
    if (
      /\b(inbound|outbound|movement|movements|dock|shipment|shipments|manifest|log)\b/i.test(lower) ||
      /(תנועות|משלוחים|קבלה|ניפוק)/.test(text)
    ) {
      const recent = ctx.dashboard.recentMovements.slice(0, 6);
      if (recent.length === 0) {
        return {
          reply: `No recent dock movements logged for ${wh.name}.`,
          provider: 'LOCAL_WMS_ENGINE',
          executedActions,
        };
      }
      const lines = recent.map(
        (m) =>
          `• [${m.type}] ${m.referenceCode}: ${m.type === 'INBOUND' ? '+' : '-'}${m.quantity} ${m.productSku}${m.locationCode ? ` (cell ${m.locationCode})` : ''} — ${m.status.toLowerCase()}`,
      );
      return {
        reply: [
          `Pending queues: ${ctx.dashboard.metrics.pendingInboundCount} inbound, ${ctx.dashboard.metrics.pendingOutboundCount} outbound.`,
          `Latest dock activity in ${wh.code}:`,
          ...lines,
        ].join('\n'),
        provider: 'LOCAL_WMS_ENGINE',
        executedActions,
      };
    }

    // 8. Warehouse Capacity / Summary Request (English & Hebrew)
    if (
      /\b(capacity|occupancy|full|summary|overview|utilization|status|matrix|size|dimensions|cells)\b/i.test(
        lower,
      ) ||
      /(תפוסה|תפוסת|קיבולת|מצב\s+המחסן|סיכום\s+מחסן|כמה\s+מלא)/.test(text)
    ) {
      const busiestRow = [...ctx.dashboard.rowBreakdown].sort(
        (a, b) => b.occupancyPercentage - a.occupancyPercentage,
      )[0];

      return {
        reply: [
          `${wh.name} (${wh.code}) is ${wh.occupancyPercentage}% full (${wh.usedCapacity}/${wh.totalCapacity} matrix cells occupied, ${wh.availableCapacity} empty).`,
          `• Total items in cells: ${wh.totalItemsCounter.toLocaleString()} across ${wh.rows}×${wh.cols} matrix`,
          `• Catalog inventory: ${ctx.dashboard.metrics.totalSkusStored} SKUs (${ctx.dashboard.metrics.totalUnitsInStock.toLocaleString()} units)`,
          busiestRow
            ? `• Highest utilization row: ${busiestRow.rowLabel} (${busiestRow.occupancyPercentage}%)`
            : '',
        ]
          .filter(Boolean)
          .join('\n'),
        provider: 'LOCAL_WMS_ENGINE',
        executedActions,
      };
    }

    // 9. Strict Abstention Fallback: Unknown item or out-of-scope question!
    const unknownTerms = ctx.extractCandidateTerms(text);
    const termHint =
      unknownTerms.length > 0 ? ` ("${unknownTerms.join(' ')}")` : '';

    return {
      reply: `I cannot answer that yet — I couldn't find matching information${termHint} in ${wh.name} (${wh.code}) warehouse data. Try asking about a stored SKU/product name, a cell code (e.g. A-01), open cells, capacity, or inbound/outbound movements.`,
      provider: 'LOCAL_WMS_ENGINE',
      executedActions,
    };
  }
}
