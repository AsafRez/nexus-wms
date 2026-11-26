import { CapacityStatus, WarehouseType } from '../../domain/entities/warehouse.entity';
import { MovementStatus, MovementType } from '../../domain/entities/stock-movement.entity';

export interface AiChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiExecutedAction {
  summary: string;
  cellCode?: string | null;
  sku?: string;
  quantity?: number;
  direction: 'INBOUND' | 'OUTBOUND' | 'CELL_ADJUST';
}

export interface WarehouseSummarySnapshot {
  id: string;
  name: string;
  code: string;
  city: string;
  address: string;
  country?: string;
  type: WarehouseType;
  rows: number;
  cols: number;
  totalCapacity: number;
  usedCapacity: number;
  availableCapacity: number;
  totalItemsCounter: number;
  occupancyPercentage: number;
  capacityStatus: CapacityStatus;
}

export interface CellProductSnapshot {
  productId: string;
  sku: string;
  productName: string;
}

export interface StorageCellSnapshot {
  id: string;
  row: number;
  col: number;
  code: string;
  currentItems: number;
  maxUnits: number;
  isOccupied: boolean;
  product: CellProductSnapshot | null;
}

export interface DashboardSnapshot {
  warehouse: WarehouseSummarySnapshot;
  matrix: StorageCellSnapshot[][];
  metrics: {
    totalSkusStored: number;
    totalUnitsInStock: number;
    pendingInboundCount: number;
    pendingOutboundCount: number;
  };
  rowBreakdown: Array<{
    rowLabel: string;
    rowIndex: number;
    totalPlaces: number;
    usedPlaces: number;
    totalItemsInRow: number;
    occupancyPercentage: number;
  }>;
  recentMovements: Array<{
    id: string;
    type: MovementType;
    referenceCode: string;
    partnerName: string;
    productSku: string;
    productName: string;
    locationCode?: string | null;
    quantity: number;
    status: MovementStatus;
    createdAt: string;
  }>;
}

export interface InventoryItemSnapshot {
  id: string;
  warehouseId: string;
  productId: string;
  sku: string;
  productName: string;
  category: string;
  unitOfMeasure: string;
  quantity: number;
  inRackQuantity?: number;
  stagedQuantity?: number;
  updatedAt: string;
}

export interface CatalogProductSnapshot {
  id: string;
  sku: string;
  name: string;
  category: string;
  unitOfMeasure: string;
}

export interface AnalyzedOrderLineItem {
  lineId: string;
  rawText: string;
  matchedProductId: string | null;
  sku: string;
  productName: string;
  category: string;
  unitOfMeasure: string;
  quantity: number;
  isNewSku: boolean;
  suggestedCellCode: string | null;
  suggestedRow: number | null;
  suggestedCol: number | null;
  confidenceNote: string;
}

export interface OrderImageAnalysisResult {
  provider: 'GEMINI_VISION' | 'LOCAL_OCR_ENGINE';
  detectedAction: 'INSERT' | 'REMOVE';
  referenceCode: string | null;
  partnerName: string;
  summary: string;
  extractedTextPreview: string;
  warnings: string[];
  items: AnalyzedOrderLineItem[];
}

