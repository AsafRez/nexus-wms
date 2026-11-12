import { WarehouseEntity } from './warehouse.entity';
import { StorageLocationEntity } from './storage-location.entity';
import { Address } from '../value-objects/address.value-object';

describe('WarehouseEntity 2D Matrix & Item Counter (OOP Domain Logic)', () => {
  it('manages a 10x10 2D matrix (54% full) and increments/decrements counters on add/remove', () => {
    const rows = 10;
    const cols = 10;
    const matrix: StorageLocationEntity[][] = [];

    let index = 0;
    for (let r = 0; r < rows; r++) {
      const rowCells: StorageLocationEntity[] = [];
      const rowLetter = String.fromCharCode(65 + r);
      for (let c = 0; c < cols; c++) {
        index++;
        const initialItems = index <= 54 ? 10 : 0;
        rowCells.push(
          new StorageLocationEntity({
            id: `cell-${r}-${c}`,
            warehouseId: 'wh-1',
            row: r,
            col: c,
            code: `${rowLetter}-${String(c + 1).padStart(2, '0')}`,
            maxUnits: 100,
            currentItems: initialItems,
          }),
        );
      }
      matrix.push(rowCells);
    }

    const warehouse = new WarehouseEntity({
      id: 'wh-1',
      businessId: 'biz-1',
      name: 'Central Hub',
      code: 'TLV-01',
      address: new Address({ city: 'Tel Aviv', street: '24 HaMasger Industrial Park' }),
      type: 'STANDARD',
      rows,
      cols,
      matrix,
    });

    // Initial state: 54 occupied cells (10 items each = 540 items) out of 100 => 54%
    expect(warehouse.totalCapacity).toBe(100);
    expect(warehouse.usedCapacity).toBe(54);
    expect(warehouse.calculateOccupancyPercentage()).toBe(54);
    expect(warehouse.totalItemsCounter).toBe(540);

    // Add 5 items to an empty cell [5, 4] (row F, col 05) -> becomes occupied (55% full, 545 items)
    const updatedCell = warehouse.addItemsAt(5, 4, 5);
    expect(updatedCell.currentItems).toBe(5);
    expect(updatedCell.isOccupied).toBe(true);
    expect(warehouse.usedCapacity).toBe(55);
    expect(warehouse.calculateOccupancyPercentage()).toBe(55);
    expect(warehouse.totalItemsCounter).toBe(545);

    // Remove those 5 items from [5, 4] -> counter returns to 0, cell becomes available (54% full, 540 items)
    warehouse.removeItemsAt(5, 4, 5);
    expect(warehouse.getCell(5, 4).currentItems).toBe(0);
    expect(warehouse.getCell(5, 4).isOccupied).toBe(false);
    expect(warehouse.usedCapacity).toBe(54);
    expect(warehouse.calculateOccupancyPercentage()).toBe(54);
    expect(warehouse.totalItemsCounter).toBe(540);
  });
});
