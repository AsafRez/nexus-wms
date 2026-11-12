import { BaseEntity } from './base.entity';

export interface ProductProps {
  id: string;
  businessId: string;
  sku: string;
  name: string;
  category: string;
  unitOfMeasure: string;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * ProductEntity represents a SKU in the Business-level product catalog.
 */
export class ProductEntity extends BaseEntity {
  private readonly _businessId: string;
  private readonly _sku: string;
  private readonly _name: string;
  private readonly _category: string;
  private readonly _unitOfMeasure: string;

  constructor(props: ProductProps) {
    super(props.id, props.createdAt, props.updatedAt);
    const cleanSku = props.sku.trim().toUpperCase();
    const cleanName = props.name.trim();
    if (!cleanSku) {
      throw new Error('Product SKU is required.');
    }
    if (!cleanName) {
      throw new Error('Product name is required.');
    }
    this._businessId = props.businessId;
    this._sku = cleanSku;
    this._name = cleanName;
    this._category = props.category.trim() || 'General';
    this._unitOfMeasure = props.unitOfMeasure.trim().toUpperCase() || 'PCS';
  }

  public get businessId(): string {
    return this._businessId;
  }

  public get sku(): string {
    return this._sku;
  }

  public get name(): string {
    return this._name;
  }

  public get category(): string {
    return this._category;
  }

  public get unitOfMeasure(): string {
    return this._unitOfMeasure;
  }
}

