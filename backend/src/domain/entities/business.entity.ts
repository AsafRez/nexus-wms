import { BaseEntity } from './base.entity';

export interface BusinessProps {
  id: string;
  name: string;
  code: string;
  industry: string;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Business Entity (Multi-Tenant Root).
 * Encapsulates company-level identity and operational status.
 */
export class BusinessEntity extends BaseEntity {
  private readonly _name: string;
  private readonly _code: string;
  private readonly _industry: string;
  private readonly _isActive: boolean;

  constructor(props: BusinessProps) {
    super(props.id, props.createdAt, props.updatedAt);
    this._name = props.name;
    this._code = props.code;
    this._industry = props.industry;
    this._isActive = props.isActive;
  }

  public get name(): string {
    return this._name;
  }

  public get code(): string {
    return this._code;
  }

  public get industry(): string {
    return this._industry;
  }

  public get isActive(): boolean {
    return this._isActive;
  }

  public assertCanOperate(): void {
    if (!this._isActive) {
      throw new Error(`Business account '${this._name}' is currently inactive.`);
    }
  }
}

