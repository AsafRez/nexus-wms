/**
 * Shared API Contracts between Web, Future Mobile App, and NestJS Backend.
 */

export type UserRole = 'ADMIN' | 'MANAGER' | 'OPERATOR';
export type WarehouseType = 'STANDARD' | 'COLD_STORAGE' | 'FULFILLMENT';
export type CapacityStatus = 'OPTIMAL' | 'MODERATE' | 'HIGH' | 'CRITICAL';
export type MovementType = 'INBOUND' | 'OUTBOUND' | 'PUTAWAY' | 'INBOUND_RECEIVE';
export type MovementStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';

export interface BusinessSummaryDto {
  id: string;
  name: string;
  code: string;
  industry: string;
}

export interface UserProfileDto {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  business: BusinessSummaryDto;
}

export interface LoginResponseDto {
  accessToken: string;
  user: UserProfileDto;
}

export interface WarehouseSummaryDto {
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

export interface MatrixRowBreakdownDto {
  rowLabel: string;
  rowIndex: number;
  totalPlaces: number;
  usedPlaces: number;
  totalItemsInRow: number;
  occupancyPercentage: number;
}

export interface MovementRecordDto {
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
}

export interface CellProductDto {
  productId: string;
  sku: string;
  productName: string;
}

export interface StorageLocationDto {
  id: string;
  row: number;
  col: number;
  code: string;
  currentItems: number;
  maxUnits: number;
  isOccupied: boolean;
  product: CellProductDto | null;
}

export interface WarehouseDashboardDto {
  warehouse: WarehouseSummaryDto;
  matrix: StorageLocationDto[][];
  metrics: {
    totalSkusStored: number;
    totalUnitsInStock: number;
    pendingInboundCount: number;
    pendingOutboundCount: number;
  };
  rowBreakdown: MatrixRowBreakdownDto[];
  recentMovements: MovementRecordDto[];
}

export interface AdjustCellResultDto {
  warehouse: WarehouseSummaryDto;
  cell: StorageLocationDto;
}

export interface WarehouseInventoryItemDto {
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

export interface StagedInventoryItemDto {
  id: string;
  warehouseId: string;
  productId: string;
  sku: string;
  productName: string;
  category: string;
  unitOfMeasure: string;
  stagedQuantity: number;
  partnerName: string;
  referenceCode: string;
  receivedAt: string;
}

export interface PutawayRequestDto {
  stagedMovementId?: string;
  productId: string;
  cellCode: string; // e.g. "A-01"
  quantity: number;
}

export interface PutawayResultDto {
  warehouse: WarehouseSummaryDto;
  cell: StorageLocationDto;
  remainingStagedQuantity: number;
  stagedItems: StagedInventoryItemDto[];
  inventory: WarehouseInventoryItemDto[];
  movement: MovementRecordDto;
}

export interface ProductCatalogItemDto {
  id: string;
  sku: string;
  name: string;
  category: string;
  unitOfMeasure: string;
}

export type InventoryActionType = 'INSERT' | 'REMOVE';

export interface NewProductInputDto {
  sku: string;
  name: string;
  category: string;
  unitOfMeasure: string;
}

export interface AdjustInventoryRequestDto {
  action: InventoryActionType;
  productId?: string;
  newProduct?: NewProductInputDto;
  quantity: number;
  row?: number;
  col?: number;
  partnerName?: string;
}

export interface AdjustInventoryResultDto {
  warehouse: WarehouseSummaryDto;
  cell: StorageLocationDto | null;
  inventory: WarehouseInventoryItemDto[];
  movement: MovementRecordDto;
}

export interface AiChatMessageDto {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiChatRequestDto {
  message: string;
  history?: AiChatMessageDto[];
}

export interface AiExecutedActionDto {
  summary: string;
  cellCode?: string | null;
  sku?: string;
  quantity?: number;
  direction: 'INBOUND' | 'OUTBOUND' | 'CELL_ADJUST';
}

export interface AiChatResponseDto {
  reply: string;
  provider: 'GEMINI' | 'LOCAL_WMS_ENGINE';
  executedActions: AiExecutedActionDto[];
  warehouse: WarehouseSummaryDto;
}

export interface AnalyzeOrderImageRequestDto {
  imageBase64: string;
  mimeType: string;
  fileName?: string;
  hintAction?: InventoryActionType;
}

export interface AnalyzedOrderLineItemDto {
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

export interface AnalyzeOrderImageResponseDto {
  provider: 'GEMINI_VISION' | 'LOCAL_OCR_ENGINE';
  detectedAction: InventoryActionType;
  referenceCode: string | null;
  partnerName: string;
  summary: string;
  extractedTextPreview: string;
  warnings: string[];
  items: AnalyzedOrderLineItemDto[];
}
