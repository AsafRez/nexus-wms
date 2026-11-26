import { BaseEntity } from './base.entity';

export type MovementType = 'INBOUND' | 'OUTBOUND' | 'PUTAWAY' | 'INBOUND_RECEIVE';
export type MovementStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';

export interface StockMovementProps {
  id: string;
  warehouseId: string;
  productSku: string;
  productName: string;
  referenceCode: string;
  partnerName: string;
  locationCode?: string | null;
  quantity: number;
  status: MovementStatus;
  createdAt?: Date;
}

/**
 * Abstract StockMovement demonstrating OOP inheritance & polymorphism
 * for Inbound (receiving) vs Outbound (shipping) operations.
 */
export abstract class StockMovementEntity extends BaseEntity {
  public readonly warehouseId: string;
  public readonly productSku: string;
  public readonly productName: string;
  public readonly referenceCode: string;
  public readonly partnerName: string;
  public readonly locationCode?: string | null;
  public readonly quantity: number;
  public readonly status: MovementStatus;

  protected constructor(props: StockMovementProps) {
    super(props.id, props.createdAt, props.createdAt);
    if (props.quantity <= 0) {
      throw new Error('Stock movement quantity must be greater than zero.');
    }
    this.warehouseId = props.warehouseId;
    this.productSku = props.productSku;
    this.productName = props.productName;
    this.referenceCode = props.referenceCode;
    this.partnerName = props.partnerName;
    this.locationCode = props.locationCode ?? null;
    this.quantity = props.quantity;
    this.status = props.status;
  }

  public abstract get movementType(): MovementType;
  public abstract get signedQuantityDelta(): number;
}

export class InboundMovementEntity extends StockMovementEntity {
  constructor(props: StockMovementProps) {
    super(props);
  }

  public get movementType(): MovementType {
    return 'INBOUND';
  }

  public get signedQuantityDelta(): number {
    return +this.quantity;
  }
}

export class OutboundMovementEntity extends StockMovementEntity {
  constructor(props: StockMovementProps) {
    super(props);
  }

  public get movementType(): MovementType {
    return 'OUTBOUND';
  }

  public get signedQuantityDelta(): number {
    return -this.quantity;
  }
}

export class PutawayMovementEntity extends StockMovementEntity {
  constructor(props: StockMovementProps) {
    super(props);
  }

  public get movementType(): MovementType {
    return 'PUTAWAY';
  }

  public get signedQuantityDelta(): number {
    return 0; // Internal shelf allocation, total warehouse quantity does not change
  }
}

export class InboundReceiveMovementEntity extends StockMovementEntity {
  constructor(props: StockMovementProps) {
    super(props);
  }

  public get movementType(): MovementType {
    return 'INBOUND_RECEIVE';
  }

  public get signedQuantityDelta(): number {
    return +this.quantity;
  }
}
