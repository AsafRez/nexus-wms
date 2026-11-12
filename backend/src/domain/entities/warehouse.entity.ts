import { BaseEntity } from './base.entity';
import { Address } from '../value-objects/address.value-object';
import { StorageLocationEntity } from './storage-location.entity';

export type WarehouseType = 'STANDARD' | 'COLD_STORAGE' | 'FULFILLMENT';
export type CapacityStatus = 'OPTIMAL' | 'MODERATE' | 'HIGH' | 'CRITICAL';

export interface WarehouseProps {
  id: string;
  businessId: string;
  name: string;
  code: string;
  address: Address;
  type: WarehouseType;
  rows: number;
  cols: number;
  matrix?: StorageLocationEntity[][];
  usedCapacitySnapshot?: number;
  totalItemsSnapshot?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * WarehouseEntity represents one physical warehouse facility whose floor
 * is organized as a 2D Matrix (rows x cols) of StorageLocationEntity cells.
 */
export class WarehouseEntity extends BaseEntity {
  private readonly _businessId: string;
  private readonly _name: string;
  private readonly _code: string;
  private readonly _address: Address;
  private readonly _type: WarehouseType;
  private readonly _rows: number;
  private readonly _cols: number;
  private readonly _matrix?: StorageLocationEntity[][];
  private _usedCapacitySnapshot: number;
  private _totalItemsCounter: number;

  constructor(props: WarehouseProps) {
    super(props.id, props.createdAt, props.updatedAt);
    if (props.rows <= 0 || props.cols <= 0) {
      throw new Error('Warehouse matrix dimensions (rows, cols) must be greater than zero.');
    }

    this._businessId = props.businessId;
    this._name = props.name;
    this._code = props.code;
    this._address = props.address;
    this._type = props.type;
    this._rows = props.rows;
    this._cols = props.cols;
    this._matrix = props.matrix;

    if (this._matrix) {
      this._usedCapacitySnapshot = this.countOccupiedCellsInMatrix();
      this._totalItemsCounter = this.sumAllItemsInMatrix();
    } else {
      this._usedCapacitySnapshot = props.usedCapacitySnapshot ?? 0;
      this._totalItemsCounter = props.totalItemsSnapshot ?? 0;
    }
  }

  public get businessId(): string {
    return this._businessId;
  }

  public get name(): string {
    return this._name;
  }

  public get code(): string {
    return this._code;
  }

  public get address(): Address {
    return this._address;
  }

  public get type(): WarehouseType {
    return this._type;
  }

  public get rows(): number {
    return this._rows;
  }

  public get cols(): number {
    return this._cols;
  }

  /**
   * Total storage places in the 2D matrix (rows * cols).
   */
  public get totalCapacity(): number {
    return this._rows * this._cols;
  }

  /**
   * Number of occupied cells in the 2D matrix.
   */
  public get usedCapacity(): number {
    return this._matrix ? this.countOccupiedCellsInMatrix() : this._usedCapacitySnapshot;
  }

  /**
   * Live counter of all items currently stored across the warehouse matrix.
   */
  public get totalItemsCounter(): number {
    return this._totalItemsCounter;
  }

  public get matrix(): ReadonlyArray<ReadonlyArray<StorageLocationEntity>> | undefined {
    return this._matrix;
  }

  /**
   * Looks up a specific [row][col] cell in the 2D matrix with bounds checking.
   */
  public getCell(row: number, col: number): StorageLocationEntity {
    if (!this._matrix) {
      throw new Error('Warehouse 2D matrix is not loaded on this instance.');
    }
    if (row < 0 || row >= this._rows || col < 0 || col >= this._cols) {
      throw new Error(
        `Coordinates [${row}, ${col}] are out of bounds for ${this._rows}x${this._cols} matrix.`,
      );
    }
    return this._matrix[row][col];
  }

  /**
   * Adds item(s) to cell [row][col] and increments the warehouse item counter.
   */
  public addItemsAt(row: number, col: number, count = 1): StorageLocationEntity {
    const cell = this.getCell(row, col);
    cell.addItems(count);
    this._totalItemsCounter += count;
    this._usedCapacitySnapshot = this.countOccupiedCellsInMatrix();
    return cell;
  }

  /**
   * Removes item(s) from cell [row][col] and decrements the warehouse item counter.
   */
  public removeItemsAt(row: number, col: number, count = 1): StorageLocationEntity {
    const cell = this.getCell(row, col);
    cell.removeItems(count);
    this._totalItemsCounter -= count;
    this._usedCapacitySnapshot = this.countOccupiedCellsInMatrix();
    return cell;
  }

  public calculateAvailableCapacity(): number {
    return Math.max(0, this.totalCapacity - this.usedCapacity);
  }

  public calculateOccupancyPercentage(): number {
    if (this.totalCapacity === 0) return 0;
    const rawPercent = (this.usedCapacity / this.totalCapacity) * 100;
    return Math.round(rawPercent * 10) / 10;
  }

  public getCapacityStatus(): CapacityStatus {
    const pct = this.calculateOccupancyPercentage();
    if (pct >= 90) return 'CRITICAL';
    if (pct >= 75) return 'HIGH';
    if (pct >= 50) return 'MODERATE';
    return 'OPTIMAL';
  }

  private countOccupiedCellsInMatrix(): number {
    if (!this._matrix) return 0;
    let occupied = 0;
    for (let r = 0; r < this._matrix.length; r++) {
      for (let c = 0; c < this._matrix[r].length; c++) {
        if (this._matrix[r][c]?.isOccupied) {
          occupied++;
        }
      }
    }
    return occupied;
  }

  private sumAllItemsInMatrix(): number {
    if (!this._matrix) return 0;
    let sum = 0;
    for (let r = 0; r < this._matrix.length; r++) {
      for (let c = 0; c < this._matrix[r].length; c++) {
        sum += this._matrix[r][c]?.currentItems ?? 0;
      }
    }
    return sum;
  }
}
