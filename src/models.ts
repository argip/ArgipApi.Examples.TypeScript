// Models of the Argip Client API v1. Property names are copied 1:1 from the JSON the API sends and
// accepts (PascalCase), including the API's own typos (Descrption, FiendlyName, NearestDilivery).
// Schema names match the ones in the API's openapi.json, so you can look any of them up there.
//
// Response strings can be null; request fields marked with "?" are optional.

/** Customer account returned by `GET v1/Customer/Info`. */
export interface CustomerInfoModel {
  CreditLimit: number;
  CreditAvailable: number;
  CurrencyName: string | null;
  /** Base discount in percent. */
  Discount: number;
  /** Additional discount in percent. */
  ExtraDiscount: number;
  /**
   * True while your account is in the testing phase: orders saved with `Order/Save` are stored as test
   * orders and never processed. When false, every saved order is a real order.
   */
  TestingPhase: boolean;
  Language: string | null;
}

/** A product category. */
export interface CategoryDto {
  CategoryId: number;
  ParentCategoryId: number;
  Name: string | null;
}

/** Details of one category, including the path from the root. */
export interface CategoryInfoDto {
  CategoryId: number;
  BreadcrumbsTrail: string | null;
  PathElements: CategoryDto[] | null;
}

/** A tag assigned to a product by Argip. */
export interface TagModel {
  Id: number;
  Value: string | null;
}

/** A tag you attached to a product yourself (see `mapCustomTag`). */
export interface CustomTagModel {
  Type: number;
  Value: string | null;
}

/** A product as seen by your account. Quantities are in pieces; prices are per 100 pieces. */
export interface ProductModel {
  ProductId: number;
  /** Groups variants of one article (e.g. different lengths of the same screw). */
  BaseProductId: number;
  Index: string | null;
  ProductFullName: string | null;
  EanBarcode: string | null;
  MultiPackEanBarcode: string | null;
  /** Pieces in one package; orders are rounded up to full packages. */
  SinglePackQuantityInPieces: number;
  /** (sic) Despite the name this is the number of SINGLE PACKS in one multipack, not pieces. */
  MultiPackQuantityInPieces: number;
  QuantityLimitLevel1: number;
  QuantityLimitLevel2: number;
  PictureUrl: string | null;
  /** List price per 100 pieces. */
  MainPrice: number;
  /** Your price per 100 pieces (after your discounts). */
  YourMainPrice: number;
  /** Your price per 100 pieces from quantity level 1. */
  YourPriceLevel1: number;
  /** Your price per 100 pieces from quantity level 2. */
  YourPriceLevel2: number;
  CurrencyId: number;
  CurrencyName: string | null;
  PiecesInStock: number;
  OtherPossibleQuantity: number;
  /** (sic) Spelled this way by the API. Always "-" in v1: do not use it. */
  NearestDilivery: string | null;
  /** Your own index, set with `mapProduct`. */
  YourIndex: string | null;
  YourProductFullName: string | null;
  YourEanBarcode: string | null;
  IsActive: boolean;
  BoxWeight: number;
  TaxRate: number;
  CountryOfOrigin: string | null;
  IsDeviation: boolean;
  Deviation: string | null;
  Tags: TagModel[] | null;
  CustomTags: CustomTagModel[] | null;
  CategoryMapping: number[] | null;
  /** Set only for an account in the testing phase: the data was validated but not saved. */
  Message?: string | null;
}

/**
 * Request body of `PUT v1/Products`: stores your own index, name and EAN for a product.
 * All three fields are REPLACED: a field you omit (or send as null) is cleared. Read the product first and
 * send back the values you want to keep.
 */
export interface MapProduct {
  ProductId: number;
  EanBarcode?: string | null;
  ProductFullName?: string | null;
  Index?: string | null;
}

/** Request body of `PUT v1/CustomTag`: attaches a custom tag to a product. */
export interface MapCustomTag {
  ProductId: number;
  TagType: number;
  TagValue: string;
}

/** Your own part number for a product. */
export interface CustomerPartsModel {
  CustomerPartsId: number;
  ProductId: number;
  Part: string | null;
  /** (sic) Spelled this way by the API. */
  Descrption: string | null;
  /** Set only for an account in the testing phase: the data was validated but not saved. */
  Message?: string | null;
}

/** Request body of `PUT v1/CustomerParts/`. Note: here the field is spelled correctly. */
export interface NewCustomerParts {
  Part: string;
  /** Optional; sent as "" when omitted. */
  Description?: string;
  ProductId: number;
}

/** A delivery address registered for your account. */
export interface ShippingAddressModel {
  ShippingAddressId: number;
  /** (sic) Spelled this way by the API. A short name for the address. */
  FiendlyName: string | null;
  PostalCode: string | null;
  Street: string | null;
  BuildingNumber: string | null;
  City: string | null;
  CountryCode: string | null;
  ContactPhone: string | null;
  ContactPerson: string | null;
  ReceivingCompanyName: string | null;
  /** Set only for an account in the testing phase: the data was validated but not saved. */
  Message?: string | null;
}

/**
 * Request body of `PUT v1/ShippingAddress/`. `ReceivingCompanyName` (empty or only spaces: 404) and `Email` (empty 404)
 * are required, as are `PostalCode`, `Street` and `BuildingNumber`; `FiendlyName` and `City` may be empty. Strings longer
 * than the documented maximum are silently truncated. The response model does not return `Email`.
 */
export interface NewShippingAddress {
  FiendlyName: string;
  PostalCode: string;
  Street: string;
  BuildingNumber: string;
  City: string;
  CountryCode: string;
  ContactPhone: string;
  ContactPerson: string;
  ReceivingCompanyName: string;
  Email: string;
}

/**
 * One line of an order: product and quantity in pieces (not packages). A quantity of 0 or less is NOT
 * rejected: it orders one full package, without any warning. Send at least 1.
 */
export interface OrderItem {
  ProductId: number;
  QuantityInPieces: number;
}

/** Request body of `POST v1/Order/Save`. */
export interface Order {
  ShippingAddressId: number;
  /** At most 30 characters: a longer value makes Save fail with an empty 404 and nothing is saved (the client rejects it before sending). */
  CustomerOrderNumber?: string | null;
  /**
   * Date-time without a zone, e.g. `"2026-11-12T00:00:00"`. The API compares it with today's date in Poland
   * (Europe/Warsaw) and rejects earlier days: see `executionDateToday()`.
   */
  ExecutionDate: string;
  Comments?: string | null;
  Items: OrderItem[];
}

/**
 * Something the API changed or skipped while processing an order. Always inspect these, and branch on
 * `Type`, not on the text. Types:
 * 1 unknown product (item skipped);
 * 2 stock problem: in Calculate "Quantity unreachable" (the item stays in the totals with the rounded quantity),
 *   in Save the quantity is reduced to the stock level;
 * 3 quantity larger than one package rounded up to full packages (only when the rounded quantity is within stock);
 * 4 Save only: out of stock, item removed from the order;
 * 5 inactive product, not on offer, or without a valid package size (item skipped).
 */
export interface WarningMessage {
  Type: number;
  ProductId: number | null;
  Comment: string | null;
}

/** One priced line of a calculated or saved order. */
export interface OrderModelItem {
  Product: ProductModel | null;
  /** Unit price per 100 pieces. */
  Price: number;
  TaxRate: number;
  PiecesOrdered: number;
  /** Pieces the API will actually deliver (can differ from PiecesOrdered, see WarningMessages). */
  PiecesReceived: number;
  ItemNetValue: number;
  ItemWeight: number;
}

/** Result of `POST v1/Order/Calculate`: a priced basket; nothing is saved. */
export interface CalcOrderModel {
  TotalWeight: number;
  TotalNetValue: number;
  TotalGrossValue: number;
  TaxValue: number;
  CurrencyName: string | null;
  Items: OrderModelItem[] | null;
  WarningMessages: WarningMessage[] | null;
}

/** Result of `POST v1/Order/Save`. */
export interface OrderModel {
  ShippingAddress: ShippingAddressModel | null;
  CustomerOrderNumber: string | null;
  ExecutionDate: string;
  Comments: string | null;
  TotalWeight: number;
  TotalNetValue: number;
  TotalGrossValue: number;
  TaxValue: number;
  CurrencyName: string | null;
  Items: OrderModelItem[] | null;
  WarningMessages: WarningMessage[] | null;
}
