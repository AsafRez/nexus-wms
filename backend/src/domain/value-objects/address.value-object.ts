export interface AddressProps {
  city: string;
  street: string;
  country?: string | null;
}

/**
 * Address Value Object (OOP).
 * Immutable object defined by its attributes (city, street, country) rather than an ID.
 */
export class Address {
  private readonly _city: string;
  private readonly _street: string;
  private readonly _country?: string;

  constructor(props: AddressProps) {
    const city = props.city?.trim();
    const street = props.street?.trim();

    if (!city) {
      throw new Error('Address city cannot be empty.');
    }
    if (!street) {
      throw new Error('Address street cannot be empty.');
    }

    this._city = city;
    this._street = street;
    this._country = props.country?.trim() || undefined;
  }

  public get city(): string {
    return this._city;
  }

  public get street(): string {
    return this._street;
  }

  public get country(): string | undefined {
    return this._country;
  }

  public formatFull(): string {
    return this._country
      ? `${this._street}, ${this._city}, ${this._country}`
      : `${this._street}, ${this._city}`;
  }

  public equals(other?: Address): boolean {
    if (!other) return false;
    return (
      this._city === other._city &&
      this._street === other._street &&
      this._country === other._country
    );
  }
}

