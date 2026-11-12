import { BaseEntity } from './base.entity';
import { BusinessEntity } from './business.entity';

export type UserRole = 'ADMIN' | 'MANAGER' | 'OPERATOR';

export interface UserProps {
  id: string;
  email: string;
  passwordHash: string;
  fullName: string;
  role: UserRole;
  business: BusinessEntity;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * User Entity encapsulating identity, tenant membership, and RBAC rules.
 */
export class UserEntity extends BaseEntity {
  private readonly _email: string;
  private readonly _passwordHash: string;
  private readonly _fullName: string;
  private readonly _role: UserRole;
  private readonly _business: BusinessEntity;

  constructor(props: UserProps) {
    super(props.id, props.createdAt, props.updatedAt);
    this._email = props.email.toLowerCase().trim();
    this._passwordHash = props.passwordHash;
    this._fullName = props.fullName;
    this._role = props.role;
    this._business = props.business;
  }

  public get email(): string {
    return this._email;
  }

  public get passwordHash(): string {
    return this._passwordHash;
  }

  public get fullName(): string {
    return this._fullName;
  }

  public get role(): UserRole {
    return this._role;
  }

  public get business(): BusinessEntity {
    return this._business;
  }

  public get businessId(): string {
    return this._business.id;
  }

  public belongsToBusiness(businessId: string): boolean {
    return this._business.id === businessId;
  }

  public canManageWarehouses(): boolean {
    return this._role === 'ADMIN' || this._role === 'MANAGER';
  }
}

