/**
 * Abstract Base Entity providing identity equality and audit timestamps.
 * All WMS domain entities inherit from BaseEntity.
 */
export abstract class BaseEntity {
  protected readonly _id: string;
  protected readonly _createdAt: Date;
  protected readonly _updatedAt: Date;

  protected constructor(id: string, createdAt: Date = new Date(), updatedAt: Date = new Date()) {
    this._id = id;
    this._createdAt = createdAt;
    this._updatedAt = updatedAt;
  }

  public get id(): string {
    return this._id;
  }

  public get createdAt(): Date {
    return this._createdAt;
  }

  public get updatedAt(): Date {
    return this._updatedAt;
  }

  public equals(other?: BaseEntity): boolean {
    if (!other) return false;
    if (this === other) return true;
    return this._id === other._id;
  }
}

