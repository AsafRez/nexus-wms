import { BaseEntity } from './base.entity';

export interface CellProduct {
  productId: string;
  sku: string;
  productName: string;
}

export interface StorageLocationProps {
  id: string;
  warehouseId: string;
  row: number;
  col: number;
  code: string;
  maxUnits: number;
  currentItems?: number;
  product?: CellProduct | null;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * StorageLocationEntity represents a single cell [row][col] inside a Warehouse's 2D Matrix.
 * Enforces the 1-product-type-per-cell domain rule alongside live item capacity (0..maxUnits).
 */
export class StorageLocationEntity extends BaseEntity {
  private readonly _warehouseId: string;
  private readonly _row: number;
  private readonly _col: number;
  private readonly _code: string;
  private readonly _maxUnits: number;
  private _currentItems: number;
  private _product: CellProduct | null;

  constructor(props: StorageLocationProps) {
    super(props.id, props.createdAt, props.updatedAt);

    if (props.row < 0 || props.col < 0) {
      throw new Error('Matrix coordinates (row, col) cannot be negative.');
    }
    if (props.maxUnits <= 0) {
      throw new Error('Storage location maxUnits must be greater than zero.');
    }

    const initialItems = props.currentItems ?? 0;
    if (initialItems < 0 || initialItems > props.maxUnits) {
      throw new Error(
        `Initial currentItems (${initialItems}) must be between 0 and maxUnits (${props.maxUnits}).`,
      );
    }

    this._warehouseId = props.warehouseId;
    this._row = props.row;
    this._col = props.col;
    this._code = props.code;
    this._maxUnits = props.maxUnits;
    this._currentItems = initialItems;
    this._product = initialItems > 0 && props.product ? { ...props.product } : null;
  }

  public get warehouseId(): string {
    return this._warehouseId;
  }

  public get row(): number {
    return this._row;
  }

  public get col(): number {
    return this._col;
  }

  public get code(): string {
    return this._code;
  }

  public get maxUnits(): number {
    return this._maxUnits;
  }

  public get currentItems(): number {
    return this._currentItems;
  }

  public get product(): CellProduct | null {
    return this._product ? { ...this._product } : null;
  }

  /**
   * Automatically occupied whenever at least 1 item is stored in this cell.
   */
  public get isOccupied(): boolean {
    return this._currentItems > 0;
  }

  public get isFull(): boolean {
    return this._currentItems >= this._maxUnits;
  }

  public get availableUnits(): number {
    return this._maxUnits - this._currentItems;
  }

  /**
   * Enforces that an occupied cell can only receive units of the SAME product SKU.
   */
  public assignOrVerifyProduct(nextProduct: CellProduct): void {
    if (
      this._currentItems > 0 &&
      this._product &&
      this._product.productId !== nextProduct.productId
    ) {
      throw new Error(
        `Cell ${this._code} already holds ${this._product.sku} (${this._product.productName}). Choose an empty cell or a cell holding ${nextProduct.sku}.`,
      );
    }
    this._product = { ...nextProduct };
  }

  /**
   * Enforces that removing a specific product from a cell matches the product stored in that cell.
   */
  public verifyProductForRemoval(productId: string, expectedSku: string): void {
    if (this._product && this._product.productId !== productId) {
      throw new Error(
        `Cell ${this._code} holds ${this._product.sku} (${this._product.productName}), not ${expectedSku}.`,
      );
    }
  }

  /**
   * Increases the item counter when items arrive into this matrix cell.
   */
  public addItems(count = 1): void {
    if (count <= 0) {
      throw new Error('Added item count must be greater than zero.');
    }
    if (this._currentItems + count > this._maxUnits) {
      throw new Error(
        `Cannot add ${count} item(s) to cell ${this._code}: exceeds max capacity of ${this._maxUnits} (currently ${this._currentItems}).`,
      );
    }
    this._currentItems += count;
  }

  /**
   * Decreases the item counter when items are removed from this matrix cell.
   * Automatically clears the cell's assigned product when the cell becomes empty (0 items).
   */
  public removeItems(count = 1): void {
    if (count <= 0) {
      throw new Error('Removed item count must be greater than zero.');
    }
    if (this._currentItems - count < 0) {
      throw new Error(
        `Cannot remove ${count} item(s) from cell ${this._code}: only ${this._currentItems} item(s) currently stored.`,
      );
    }
    this._currentItems -= count;
    if (this._currentItems === 0) {
      this._product = null;
    }
  }
}
