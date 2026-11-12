import {
  AdjustCellResultDto,
  AdjustInventoryRequestDto,
  AdjustInventoryResultDto,
  MovementRecordDto,
  MovementType,
  ProductCatalogItemDto,
  StorageLocationDto,
  WarehouseDashboardDto,
  WarehouseInventoryItemDto,
  WarehouseSummaryDto,
} from '../../../shared/wms.contracts';
import { WarehouseViewModel } from '../models/WarehouseViewModel';
import { HttpClient, sharedHttpClient } from './HttpClient';

export class WarehouseApiService {
  constructor(private readonly client: HttpClient = sharedHttpClient) {}

  async fetchWarehouses(): Promise<WarehouseViewModel[]> {
    const dtos = await this.client.get<WarehouseSummaryDto[]>('/warehouses');
    return dtos.map((dto) => new WarehouseViewModel(dto));
  }

  async fetchDashboard(warehouseId: string): Promise<WarehouseDashboardDto> {
    return this.client.get<WarehouseDashboardDto>(`/warehouses/${warehouseId}/dashboard`);
  }

  async fetchLocations(warehouseId: string): Promise<StorageLocationDto[]> {
    return this.client.get<StorageLocationDto[]>(`/warehouses/${warehouseId}/locations`);
  }

  async adjustMatrixCell(
    warehouseId: string,
    row: number,
    col: number,
    delta: number,
  ): Promise<AdjustCellResultDto> {
    return this.client.post<AdjustCellResultDto>(
      `/warehouses/${warehouseId}/matrix/${row}/${col}/adjust`,
      { delta },
    );
  }

  async fetchCatalog(warehouseId: string): Promise<ProductCatalogItemDto[]> {
    return this.client.get<ProductCatalogItemDto[]>(`/warehouses/${warehouseId}/catalog`);
  }

  async fetchInventory(warehouseId: string): Promise<WarehouseInventoryItemDto[]> {
    return this.client.get<WarehouseInventoryItemDto[]>(`/warehouses/${warehouseId}/inventory`);
  }

  async adjustInventory(
    warehouseId: string,
    payload: AdjustInventoryRequestDto,
  ): Promise<AdjustInventoryResultDto> {
    return this.client.post<AdjustInventoryResultDto>(
      `/warehouses/${warehouseId}/inventory/adjust`,
      payload,
    );
  }

  async fetchMovements(warehouseId: string, type: MovementType): Promise<MovementRecordDto[]> {
    return this.client.get<MovementRecordDto[]>(
      `/warehouses/${warehouseId}/movements?type=${type}`,
    );
  }
}

export const warehouseApiService = new WarehouseApiService();
