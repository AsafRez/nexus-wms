import { BaseEntity } from './base.entity';

export interface ItemInventoryProps {
  id: string;
  warehouseId: string;
  productId: string;
  sku: string;
  productName: string;
  category: string;
  unitOfMeasure: string;
  quantity: number;
  updatedAt?: Date;
}

/**
 * ItemInventoryEntity represents what stock a specific Warehouse currently holds,
 * referencing the Business-level Product catalog without requiring StorageLocations.
 */
export class ItemInventoryEntity extends BaseEntity {
  private readonly _warehouseId: string;
  private readonly _productId: string;
  private readonly _sku: string;
  private readonly _productName: string;
  private readonly _category: string;
  private readonly _unitOfMeasure: string;
  private _quantity: number;

  constructor(props: ItemInventoryProps) {
    super(props.id, props.updatedAt, props.updatedAt);
    if (props.quantity < 0) {
      throw new Error('Warehouse inventory quantity cannot be negative.');
    }
    this._warehouseId = props.warehouseId;
    this._productId = props.productId;
    this._sku = props.sku;
    this._productName = props.productName;
    this._category = props.category;
    this._unitOfMeasure = props.unitOfMeasure;
    this._quantity = props.quantity;
  }

  public get warehouseId(): string {
    return this._warehouseId;
  }

  public get productId(): string {
    return this._productId;
  }

  public get sku(): string {
    return this._sku;
  }

  public get productName(): string {
    return this._productName;
  }

  public get category(): string {
    return this._category;
  }

  public get unitOfMeasure(): string {
    return this._unitOfMeasure;
  }

  public get quantity(): number {
    return this._quantity;
  }

  public adjustQuantity(delta: number): void {
    const next = this._quantity + delta;
    if (next < 0) {
      throw new Error(`Insufficient stock for SKU ${this._sku}.`);
    }
    this._quantity = next;
  }
}

