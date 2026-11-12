import {
  CapacityStatus,
  WarehouseSummaryDto,
  WarehouseType,
} from '../../../shared/wms.contracts';

/**
 * Frontend Domain ViewModel encapsulating warehouse presentation rules
 * and capacity formatting logic.
 */
export class WarehouseViewModel {
  constructor(private readonly dto: WarehouseSummaryDto) {}

  get id(): string {
    return this.dto.id;
  }

  get name(): string {
    return this.dto.name;
  }

  get code(): string {
    return this.dto.code;
  }

  get city(): string {
    return this.dto.city;
  }

  get address(): string {
    return this.dto.address;
  }

  get type(): WarehouseType {
    return this.dto.type;
  }

  get rows(): number {
    return this.dto.rows;
  }

  get cols(): number {
    return this.dto.cols;
  }

  get totalCapacity(): number {
    return this.dto.totalCapacity;
  }

  get usedCapacity(): number {
    return this.dto.usedCapacity;
  }

  get availableCapacity(): number {
    return this.dto.availableCapacity;
  }

  get totalItemsCounter(): number {
    return this.dto.totalItemsCounter;
  }

  get occupancyPercentage(): number {
    return this.dto.occupancyPercentage;
  }

  get capacityStatus(): CapacityStatus {
    return this.dto.capacityStatus;
  }

  get matrixDimensionsText(): string {
    return `${this.dto.rows} × ${this.dto.cols} matrix`;
  }

  get formattedFullLabel(): string {
    return `${this.dto.occupancyPercentage}% full`;
  }

  get placesSummaryText(): string {
    return `${this.dto.usedCapacity} of ${this.dto.totalCapacity} cells occupied (${this.dto.rows}×${this.dto.cols})`;
  }

  get typeDisplayName(): string {
    switch (this.dto.type) {
      case 'COLD_STORAGE':
        return 'Cold storage';
      case 'FULFILLMENT':
        return 'Fulfillment hub';
      default:
        return 'Distribution center';
    }
  }

  get statusBadgeInfo(): { label: string; toneClass: string } {
    switch (this.dto.capacityStatus) {
      case 'CRITICAL':
        return { label: 'Near capacity', toneClass: 'tone-critical' };
      case 'HIGH':
        return { label: 'High load', toneClass: 'tone-high' };
      case 'MODERATE':
        return { label: 'Steady load', toneClass: 'tone-steady' };
      default:
        return { label: 'Open capacity', toneClass: 'tone-open' };
    }
  }
}
