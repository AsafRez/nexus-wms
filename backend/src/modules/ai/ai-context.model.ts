import {
  CatalogProductSnapshot,
  DashboardSnapshot,
  InventoryItemSnapshot,
  StorageCellSnapshot,
} from './ai.types';

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[m][n];
}

const QUERY_STOP_WORDS = new Set([
  'where',
  'can',
  'find',
  'the',
  'is',
  'are',
  'how',
  'many',
  'much',
  'what',
  'which',
  'cell',
  'cells',
  'location',
  'locations',
  'stored',
  'have',
  'has',
  'show',
  'tell',
  'get',
  'for',
  'about',
  'with',
  'from',
  'into',
  'stock',
  'inventory',
  'warehouse',
  'items',
  'item',
  'units',
  'unit',
  'product',
  'products',
  'sku',
  'skus',
  'there',
  'any',
  'our',
  'you',
  'please',
  // Common Hebrew warehouse query stop-words (for Hebglish / Hebrew queries)
  'איפה',
  'היכן',
  'נמצא',
  'נמצאים',
  'כמה',
  'יחידות',
  'פריטים',
  'במחסן',
  'המחסן',
  'מחסן',
  'מלאי',
  'במלאי',
  'המלאי',
  'בתא',
  'לתא',
  'מתא',
  'תאים',
  'פנויים',
  'ריקים',
  'תפוסה',
  'תפוסת',
  'קיבולת',
  'מצב',
  'וכמה',
  'יש',
  'של',
  'את',
  'האם',
  'בבקשה',
]);

/**
 * Encapsulates live warehouse state for AI reasoning, typo-tolerant SKU lookup, and cell grounding.
 */
export class WarehouseAiContext {
  public readonly flatCells: StorageCellSnapshot[];

  constructor(
    public readonly businessId: string,
    public readonly dashboard: DashboardSnapshot,
    public readonly inventory: InventoryItemSnapshot[],
    public readonly catalog: CatalogProductSnapshot[],
  ) {
    this.flatCells = dashboard.matrix.flat();
  }

  public get openCells(): StorageCellSnapshot[] {
    return this.flatCells.filter((c) => !c.isOccupied);
  }

  public get occupiedCells(): StorageCellSnapshot[] {
    return this.flatCells.filter((c) => c.currentItems > 0);
  }

  public getCellsForProduct(productId: string): StorageCellSnapshot[] {
    return this.occupiedCells.filter((c) => c.product?.productId === productId);
  }

  public findCellByCode(codeRaw: string): StorageCellSnapshot | null {
    const cleaned = codeRaw.trim().toUpperCase();
    const match = cleaned.match(/^([A-Z])-?(\d{1,2})$/);
    if (match) {
      const normalized = `${match[1]}-${match[2].padStart(2, '0')}`;
      return this.flatCells.find((c) => c.code.toUpperCase() === normalized) ?? null;
    }
    return this.flatCells.find((c) => c.code.toUpperCase() === cleaned) ?? null;
  }

  public findFirstCellForInsert(
    minAvailableSpace: number,
    productId?: string,
  ): StorageCellSnapshot | null {
    // 1. Prioritize consolidating into an existing cell that already holds this product
    if (productId) {
      const existingCell = this.flatCells.find(
        (c) =>
          c.product?.productId === productId &&
          c.maxUnits - c.currentItems >= minAvailableSpace,
      );
      if (existingCell) return existingCell;
    }

    // 2. Otherwise pick the first open/empty cell
    return (
      this.openCells.find((c) => c.maxUnits - c.currentItems >= minAvailableSpace) ??
      this.flatCells.find(
        (c) =>
          c.maxUnits - c.currentItems >= minAvailableSpace &&
          (!c.product || c.product.productId === productId),
      ) ??
      null
    );
  }

  public findFirstCellForRemove(
    minCurrentItems: number,
    productId?: string,
  ): StorageCellSnapshot | null {
    if (productId) {
      return (
        this.occupiedCells.find(
          (c) => c.product?.productId === productId && c.currentItems >= minCurrentItems,
        ) ?? null
      );
    }
    return this.occupiedCells.find((c) => c.currentItems >= minCurrentItems) ?? null;
  }

  public extractCandidateTerms(queryRaw: string): string[] {
    return queryRaw
      .toLowerCase()
      .replace(/["'?!.,;:()[\]]/g, ' ')
      .split(/\s+/)
      .map((w) => w.trim())
      .filter((w) => w.length >= 3 && !QUERY_STOP_WORDS.has(w));
  }

  private scoreWordAgainstTokens(queryWord: string, targetTokens: string[]): number {
    const singular = queryWord.replace(/s$/, '');
    let bestScore = 0;

    for (const token of targetTokens) {
      const tokenSingular = token.replace(/s$/, '');
      if (token === queryWord || tokenSingular === singular) {
        bestScore = Math.max(bestScore, 3);
      } else if (
        (singular.length >= 4 && token.includes(singular)) ||
        (tokenSingular.length >= 4 && singular.includes(tokenSingular))
      ) {
        bestScore = Math.max(bestScore, 2);
      } else if (singular.length >= 4 && tokenSingular.length >= 4) {
        const maxDist = singular.length >= 7 ? 2 : 1;
        if (levenshteinDistance(singular, tokenSingular) <= maxDist) {
          bestScore = Math.max(bestScore, 2);
        }
      }
    }

    return bestScore;
  }

  public matchCatalogProduct(queryRaw: string): CatalogProductSnapshot | null {
    const q = queryRaw.trim().toLowerCase();
    if (!q) return null;

    const exactSku = this.catalog.find((p) => p.sku.toLowerCase() === q);
    if (exactSku) return exactSku;

    const skuContained = this.catalog.find((p) => q.includes(p.sku.toLowerCase()));
    if (skuContained) return skuContained;

    const terms = this.extractCandidateTerms(queryRaw);
    if (terms.length === 0) return null;

    let best: { item: CatalogProductSnapshot; score: number } | null = null;
    for (const prod of this.catalog) {
      const targetTokens = `${prod.name} ${prod.category} ${prod.sku}`
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 2);

      let score = 0;
      for (const term of terms) {
        score += this.scoreWordAgainstTokens(term, targetTokens);
      }
      if (score > 0 && (!best || score > best.score)) {
        best = { item: prod, score };
      }
    }

    return best?.item ?? null;
  }

  public matchAllCatalogProducts(queryRaw: string): CatalogProductSnapshot[] {
    const q = queryRaw.trim().toLowerCase();
    if (!q) return [];

    const exactSku = this.catalog.find((p) => p.sku.toLowerCase() === q);
    if (exactSku) return [exactSku];

    const terms = this.extractCandidateTerms(queryRaw);
    if (terms.length === 0) return [];

    const scored: Array<{ item: CatalogProductSnapshot; score: number }> = [];
    for (const prod of this.catalog) {
      const targetTokens = `${prod.name} ${prod.category} ${prod.sku}`
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 2);

      let score = 0;
      for (const term of terms) {
        score += this.scoreWordAgainstTokens(term, targetTokens);
      }
      if (score >= 2) {
        scored.push({ item: prod, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.map((s) => s.item);
  }

  public matchAllInventoryItems(queryRaw: string): InventoryItemSnapshot[] {
    const q = queryRaw.trim().toLowerCase();
    if (!q) return [];

    const exactSku = this.inventory.find((i) => i.sku.toLowerCase() === q);
    if (exactSku) return [exactSku];

    const terms = this.extractCandidateTerms(queryRaw);
    if (terms.length === 0) return [];

    const scored: Array<{ item: InventoryItemSnapshot; score: number }> = [];
    for (const inv of this.inventory) {
      const targetTokens = `${inv.productName} ${inv.category} ${inv.sku}`
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 2);

      let score = 0;
      for (const term of terms) {
        score += this.scoreWordAgainstTokens(term, targetTokens);
      }
      if (score >= 2) {
        scored.push({ item: inv, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.map((s) => s.item);
  }

  public matchInventoryItem(queryRaw: string): InventoryItemSnapshot | null {
    const q = queryRaw.trim().toLowerCase();
    if (!q) return null;

    const exactSku = this.inventory.find((i) => i.sku.toLowerCase() === q);
    if (exactSku) return exactSku;

    const skuContained = this.inventory.find((i) => q.includes(i.sku.toLowerCase()));
    if (skuContained) return skuContained;

    const terms = this.extractCandidateTerms(queryRaw);
    if (terms.length === 0) return null;

    let best: { item: InventoryItemSnapshot; score: number } | null = null;
    for (const inv of this.inventory) {
      const targetTokens = `${inv.productName} ${inv.category} ${inv.sku}`
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 2);

      let score = 0;
      for (const term of terms) {
        score += this.scoreWordAgainstTokens(term, targetTokens);
      }
      if (score > 0 && (!best || score > best.score)) {
        best = { item: inv, score };
      }
    }

    return best?.item ?? null;
  }

  public buildSystemPromptSummary(): string {
    const wh = this.dashboard.warehouse;
    const openCodes = this.openCells.map((c) => c.code);

    const invText =
      this.inventory.length > 0
        ? this.inventory
            .map((i) => {
              const cells = this.getCellsForProduct(i.productId)
                .map((c) => `${c.code} (${c.currentItems}/${c.maxUnits})`)
                .join(', ');
              return `- ${i.sku}: ${i.productName} | Total warehouse stock: ${i.quantity} ${i.unitOfMeasure} | Category: ${i.category} | Stored in cells: ${cells || 'None assigned'}`;
            })
            .join('\n')
        : '- (No SKU inventory currently stored in this warehouse)';

    const catText = this.catalog
      .map((p) => `- ${p.sku}: ${p.name} [${p.unitOfMeasure}] (${p.category})`)
      .join('\n');

    const rowsText = this.dashboard.rowBreakdown
      .map(
        (r) =>
          `${r.rowLabel}: ${r.usedPlaces}/${r.totalPlaces} cells occupied (${r.occupancyPercentage}%), ${r.totalItemsInRow} items`,
      )
      .join(' | ');

    const movementsText =
      this.dashboard.recentMovements.length > 0
        ? this.dashboard.recentMovements
            .map((m) => {
              const safePartner = m.partnerName.replace(/[\r\n"`]/g, ' ').slice(0, 80);
              return `- [${m.type}] ${m.referenceCode}: ${m.quantity} x ${m.productSku} (${m.productName}) | Partner (untrusted label): ${safePartner} | Cell: ${m.locationCode || 'N/A'} | Status: ${m.status}`;
            })
            .join('\n')
        : '- None';

    return [
      `You are Helper Boxiy, the expert warehouse operations assistant for ${wh.name} (${wh.code}).`,
      `OPERATIONAL RULES & HUMAN-CENTERED INTERACTION:`,
      `1. TOLERATE CASUAL SPEECH & TYPOS: Warehouse staff speak informally using shorthand, typos, nicknames, or descriptions (e.g. "cables", "proximity sensors", "euro pallet sensors", "power supply", "solenoid valves", "the Munich delivery"). Intelligently match their phrases to our known catalog SKUs and warehouse stock.`,
      `2. SMART PUTAWAY & CELL SELECTION: When an operator asks to store, insert, or put items away without naming a cell (e.g. "Put 20 cables away" or "Store 50 pallet sensors"):`,
      `   - Auto-assign the optimal cell! Check if that SKU already occupies a cell with free capacity to consolidate items together. If not, select the first available empty cell in the lowest-occupancy row.`,
      `   - Call the insert_inventory_item tool with the resolved SKU, quantity, and selected cell, and inform the user which cell was chosen and how much capacity remains.`,
      `3. PRODUCT VARIANT DISAMBIGUATION (Lengths, Sizes, Voltages): Many warehouse products share a general category or name (e.g. "cables" can be 10-Meter vs 23-Meter, "sensors" can be Pallet Sensor vs M18 Proximity, "power supplies" can be 12V vs 24V).`,
      `   - If the operator specifies the length, spec, or variant (e.g. "20 of the 10m cables" or "store the 23-meter cable"), match that exact variant directly.`,
      `   - If the operator only gives a generic name (e.g. "Where are the cables?" or "Put 20 cables away") and multiple matching variants exist in the catalog, NEVER GUESS. Proactively list the available variants with their specifications (length, model, SKU) and current stock, and ask which one they mean:`,
      `     "Which cable variant do you have?`,
      `     1. 10-Meter Industrial Cable (CON-CBL-10M)`,
      `     2. 23-Meter Industrial Cable (CON-CBL-23M)"`,
      `   - When the operator replies with the length or number ("the 10m one" or "first one"), continue immediately with that SKU.`,
      `4. MULTI-TURN MEMORY: Keep track of previous messages in the conversation. When an operator says "take 10 out" or "where is it stored?", connect it to the product or cell discussed in the previous message.`,
      `5. DIRECT TOOL EXECUTION: When the operator's intent is clearly to add, receive, pick, or remove inventory, call insert_inventory_item or remove_inventory_item directly. Don't make the operator type technical commands.`,
      `6. CONVERSATIONAL TONE & LANGUAGE: Reply in the same language the user speaks (English, Hebrew, etc.). Keep messages concise, friendly, and operationally focused (use bold text for SKUs, quantities, and cell codes like **A-01**).`,
      `7. GROUNDING: Answer strictly from the live warehouse data below. If asked about out-of-scope external information (like item retail prices, employee salaries, or weather), state that it is not recorded in warehouse data.`,
      `Active Warehouse: ${wh.name} (${wh.code}) in ${wh.city}, ${wh.address}.`,
      `Matrix Dimensions: ${wh.rows} rows x ${wh.cols} columns (${wh.totalCapacity} cells total, max 100 items per cell, strictly 1 product type per cell).`,
      `Live Occupancy: ${wh.occupancyPercentage}% full (${wh.usedCapacity} occupied cells, ${wh.availableCapacity} empty cells, ${wh.totalItemsCounter} total items in cells). Status: ${wh.capacityStatus}.`,
      `Row Breakdown: ${rowsText}`,
      `Empty Cells (0/100): ${openCodes.length > 0 ? openCodes.join(', ') : 'None'}`,
      `Current Warehouse SKU Inventory & Exact Cell Locations:\n${invText}`,
      `Recent Inbound/Outbound Movements:\n${movementsText}`,
      `Full Business SKU Catalog (available to insert):\n${catText}`,
    ].join('\n');
  }
}
