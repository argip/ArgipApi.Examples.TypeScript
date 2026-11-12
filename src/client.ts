import { ArgipApiError, ArgipInputError } from "./errors.js";
import type {
  CalcOrderModel,
  CategoryDto,
  CategoryInfoDto,
  CustomerInfoModel,
  CustomerPartsModel,
  MapCustomTag,
  MapProduct,
  NewCustomerParts,
  NewShippingAddress,
  Order,
  OrderItem,
  OrderModel,
  ProductModel,
  ShippingAddressModel,
} from "./models.js";

export const DEFAULT_API_URL = "https://argipapi.argip.com.pl/";
export const DEFAULT_TOKEN_URL = "https://identityserver.argip.com.pl/connect/token";

/** Longest `CustomerOrderNumber` the API accepts. */
export const MAX_CUSTOMER_ORDER_NUMBER_LENGTH = 30;

/** Default request timeout in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 100_000;

// Renew a little before expiry so a request never starts with a token that dies on the way.
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/** Connection settings. Credentials come from the Argip sales department. */
export interface ArgipApiOptions {
  clientId: string;
  clientSecret: string;
  /** Defaults to {@link DEFAULT_API_URL}. */
  apiUrl?: string;
  /** Defaults to {@link DEFAULT_TOKEN_URL}. */
  tokenUrl?: string;
  /** Defaults to "argipapi". */
  scope?: string;
  /** Timeout of every HTTP request in milliseconds. Defaults to {@link DEFAULT_TIMEOUT_MS}. A timeout is reported as a network error. */
  timeoutMs?: number;
}

/** Content of the X-Pagination response header of paged lists. Pages are numbered from 0. */
export interface Pagination {
  TotalCount: number;
  TotalPages: number;
  /** Empty string when there is no previous page. */
  PrevPageLink: string;
  /** Empty string when there is no next page. */
  NextPageLink: string;
}

/** One page of a paged list. */
export interface Page<T> {
  items: T[];
  pagination: Pagination;
}

/** Reads ARGIP_CLIENT_ID, ARGIP_CLIENT_SECRET and the optional ARGIP_API_URL / ARGIP_TOKEN_URL. */
export function optionsFromEnv(): ArgipApiOptions {
  const required = (name: string): string => {
    const value = process.env[name];
    if (!value) throw new ArgipInputError(`Environment variable ${name} is empty or not set. Put it in .env (copy .env.example) or in the environment.`);
    return value;
  };
  return {
    clientId: required("ARGIP_CLIENT_ID"),
    clientSecret: required("ARGIP_CLIENT_SECRET"),
    apiUrl: process.env["ARGIP_API_URL"] || undefined,
    tokenUrl: process.env["ARGIP_TOKEN_URL"] || undefined,
  };
}

/**
 * Typed client for the Argip Client API (v1). Create one instance per application: it caches the access token.
 * Quantities are in pieces; prices are per 100 pieces.
 *
 * `fetchFn` and `clock` (milliseconds, like `Date.now`) exist so tests can replace the network and the time.
 */
export class ArgipApiClient {
  private readonly apiUrl: string;
  private readonly tokenUrl: string;
  private readonly scope: string;
  private readonly timeoutMs: number;
  private token: string | null = null;
  private tokenExpiresAt = 0;
  // Single flight: concurrent callers share one token request instead of each sending their own.
  private inflight: Promise<string> | null = null;

  constructor(
    private readonly options: ArgipApiOptions,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly clock: () => number = Date.now,
  ) {
    // A trailing slash matters: relative paths like "v1/Products" are appended to this address.
    const apiUrl = requireUrl(options.apiUrl ?? DEFAULT_API_URL, "ARGIP_API_URL");
    this.apiUrl = apiUrl.endsWith("/") ? apiUrl : `${apiUrl}/`;
    this.tokenUrl = requireUrl(options.tokenUrl ?? DEFAULT_TOKEN_URL, "ARGIP_TOKEN_URL");
    this.scope = options.scope ?? "argipapi";
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) throw new ArgipInputError("timeoutMs must be a positive number of milliseconds.");
  }

  // ---- Customer ----

  /** Your account: credit, discounts and whether you are in the testing phase. */
  getCustomerInfo(): Promise<CustomerInfoModel> {
    return this.get("v1/Customer/Info");
  }

  // ---- Categories ----

  getCategories(): Promise<CategoryDto[]> {
    return this.get("v1/Categories");
  }

  getMainCategories(): Promise<CategoryDto[]> {
    return this.get("v1/MainCategories");
  }

  getCategory(id: number): Promise<CategoryInfoDto> {
    return this.get(`v1/Categories/${id}`);
  }

  // ---- Products ----

  /**
   * One page of products (page numbers start at 0, pageSize 1-1000).
   * @param activeOnly true: only active products; false: also inactive ones (always only products on offer).
   * @param quickFilter Optional free-text filter, e.g. "DIN 931 M8x80".
   *
   * No matching products is NOT an error here: the API answers an empty 404, which this method turns into an
   * empty page (`items` empty, `TotalCount` 0).
   */
  getProducts(page: number, pageSize: number, activeOnly: boolean, quickFilter?: string): Promise<Page<ProductModel>> {
    let path = `v1/Products/${page}/${pageSize}/${activeOnly ? "true" : "false"}`;
    if (quickFilter) path += `?quickfilter=${encodeURIComponent(quickFilter)}`;
    return this.getPage(path, page, pageSize);
  }

  /** Every product, page by page (yields nothing when there are none). Use pageSize 1000 for a full catalogue sync. */
  async *iterateAllProducts(pageSize: number, activeOnly: boolean, quickFilter?: string): AsyncGenerator<ProductModel> {
    for (let page = 0; ; page++) {
      const result = await this.getProducts(page, pageSize, activeOnly, quickFilter);
      yield* result.items;
      if (page >= result.pagination.TotalPages - 1) return;
    }
  }

  getProduct(id: number): Promise<ProductModel> {
    return this.get(`v1/Products/${id}`);
  }

  getProductsByCategory(categoryId: number): Promise<ProductModel[]> {
    return this.get(`v1/Products/Category/${categoryId}`);
  }

  getProductsByBaseProduct(baseProductId: number): Promise<ProductModel[]> {
    return this.get(`v1/Products/BaseProduct/${baseProductId}`);
  }

  getProductByEan(ean: string): Promise<ProductModel> {
    return this.get(`v1/Products/Ean/${encodeURIComponent(ean)}`);
  }

  /**
   * Finds a product by YOUR own index (set with `mapProduct`). The index is URL-encoded, but an index that
   * contains "/" cannot be found: ASP.NET Core does not decode `%2F` in route values (the API answers 404).
   */
  getProductByYourIndex(index: string): Promise<ProductModel> {
    return this.get(`v1/Products/YourIndex/${encodeURIComponent(index)}`);
  }

  /**
   * WRITES: stores your own index, name and EAN for an Argip product. All three fields are REPLACED: a field
   * you omit is cleared. Read the product first and send back the values you want to keep.
   * In the testing phase the data is validated but not saved, and the response has `Message` set.
   */
  mapProduct(body: MapProduct): Promise<ProductModel> {
    return this.send("PUT", "v1/Products", body);
  }

  /** WRITES: stores a custom tag for an Argip product. In the testing phase it is validated but not saved, and the response has `Message` set. */
  mapCustomTag(body: MapCustomTag): Promise<ProductModel> {
    return this.send("PUT", "v1/CustomTag", body);
  }

  // ---- Customer parts ----

  /** One page of your part numbers. No parts at all gives an empty page (the API's empty 404 is turned into it). */
  getCustomerParts(page: number, pageSize: number): Promise<Page<CustomerPartsModel>> {
    return this.getPage(`v1/CustomerParts/${page}/${pageSize}`, page, pageSize);
  }

  getCustomerPart(productId: number): Promise<CustomerPartsModel> {
    return this.get(`v1/CustomerParts/${productId}`);
  }

  /**
   * WRITES: adds or replaces your part number for a product. An omitted description is sent as "".
   * In the testing phase the data is validated but not saved: `Message` is set and a new part has `CustomerPartsId` 0.
   */
  putCustomerPart(body: NewCustomerParts): Promise<CustomerPartsModel> {
    return this.send("PUT", "v1/CustomerParts/", { ...body, Description: body.Description ?? "" });
  }

  /** WRITES: deletes your part number for a product. In the testing phase nothing is deleted and the response has `Message` set. */
  deleteCustomerPart(productId: number): Promise<CustomerPartsModel> {
    return this.send("DELETE", `v1/CustomerParts/${productId}`);
  }

  // ---- Shipping addresses ----

  /** One page of your delivery addresses. No addresses gives an empty page (the API's empty 404 is turned into it). */
  getShippingAddresses(page: number, pageSize: number): Promise<Page<ShippingAddressModel>> {
    return this.getPage(`v1/ShippingAddress/${page}/${pageSize}`, page, pageSize);
  }

  getShippingAddress(id: number): Promise<ShippingAddressModel> {
    return this.get(`v1/ShippingAddress/${id}`);
  }

  /**
   * WRITES: creates a new delivery address in Argip's system. It is real data, not a draft.
   * `Email` and `ReceivingCompanyName` are required (the API answers 404 without them).
   * In the testing phase the address is validated but not saved: `Message` is set and `ShippingAddressId` is 0.
   */
  putShippingAddress(body: NewShippingAddress): Promise<ShippingAddressModel> {
    return this.send("PUT", "v1/ShippingAddress/", body);
  }

  // ---- Orders ----

  /** Prices and checks a basket without saving anything. Always read `WarningMessages`. */
  calculateOrder(items: OrderItem[]): Promise<CalcOrderModel> {
    return this.send("POST", "v1/Order/Calculate", items);
  }

  /**
   * WRITES: places an order. It is a REAL order unless Customer/Info says TestingPhase = true.
   * A 200 response does not guarantee anything was saved: check `Items` and `WarningMessages`.
   * Never resend automatically after an empty 404 or a timeout: the outcome is UNKNOWN and the order may exist.
   * Check with Argip first, or you may create a duplicate.
   * Throws `ArgipInputError` (nothing is sent) when `CustomerOrderNumber` is longer than 30 characters.
   */
  async saveOrder(order: Order): Promise<OrderModel> {
    const number = order.CustomerOrderNumber;
    if (number != null && number.length > MAX_CUSTOMER_ORDER_NUMBER_LENGTH) {
      throw new ArgipInputError(`CustomerOrderNumber can have at most ${MAX_CUSTOMER_ORDER_NUMBER_LENGTH} characters, got ${number.length}.`);
    }
    return this.send("POST", "v1/Order/Save", order);
  }

  // ---- Plumbing ----

  private get<T>(path: string): Promise<T> {
    return this.send("GET", path);
  }

  private async send<T>(method: string, path: string, body?: unknown): Promise<T> {
    return this.readJson<T>(await this.sendRaw(method, path, body));
  }

  private async getPage<T>(path: string, page: number, pageSize: number): Promise<Page<T>> {
    if (!Number.isInteger(page) || page < 0) throw new ArgipInputError(`page must be an integer of 0 or more, got ${page}.`);
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) throw new ArgipInputError(`pageSize must be an integer from 1 to 1000, got ${pageSize}.`);
    // The API answers an EMPTY 404 for a list with no items and cannot tell it apart from an unexpected
    // server error. A list is a read, so treat it as "no items"; a real fault shows up on the next call.
    // Only the answer to the list request itself counts: a failed token request always throws.
    const response = await this.sendRaw("GET", path, undefined, true);
    if (response === null) return { items: [], pagination: { TotalCount: 0, TotalPages: 0, PrevPageLink: "", NextPageLink: "" } };
    const items = await this.readJson<T[]>(response);
    // Paged lists describe the paging in the X-Pagination header (JSON), not in the body.
    const header = response.headers.get("X-Pagination");
    const pagination: Pagination = header
      ? (parseJson<Pagination>(header, "The X-Pagination header"))
      : { TotalCount: items.length, TotalPages: 1, PrevPageLink: "", NextPageLink: "" };
    return { items, pagination };
  }

  private async sendRaw(method: string, path: string, body?: unknown): Promise<Response>;
  private async sendRaw(method: string, path: string, body: unknown, emptyNotFoundAsNull: true): Promise<Response | null>;
  private async sendRaw(method: string, path: string, body?: unknown, emptyNotFoundAsNull = false): Promise<Response | null> {
    let previousToken: string | undefined;
    for (let attempt = 0; ; attempt++) {
      // On the second attempt get a new token: the cached one was rejected (e.g. revoked or server restarted).
      const token = await this.getToken(previousToken);
      previousToken = token;
      const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: "application/json" };
      const init: RequestInit = { method, headers, signal: AbortSignal.timeout(this.timeoutMs) };
      if (body !== undefined) {
        // The API uses PascalCase property names (ProductId, QuantityInPieces); JSON.stringify keeps them as written.
        headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(body);
      }

      const response = await this.fetchFn(new URL(path, this.apiUrl).toString(), init);
      if (response.status === 401 && attempt === 0) {
        await response.body?.cancel();
        continue;
      }
      if (response.ok) return response;
      const errorBody = await response.text();
      if (emptyNotFoundAsNull && response.status === 404 && errorBody === "") return null;
      throw ArgipApiError.fromResponse(response.status, errorBody);
    }
  }

  private async readJson<T>(response: Response): Promise<T> {
    const text = await response.text();
    if (!text) throw new Error("The API returned an empty body.");
    return parseJson<T>(text, "The API response");
  }

  /**
   * Gets an access token with the OAuth 2.0 client credentials flow and caches it.
   * Tokens are valid for 8 hours: do NOT request a new token for every API call.
   * `previousToken` is the token the API just answered 401 to: it forces a refresh, unless another caller
   * has already replaced it (then the newer token is reused).
   */
  private getToken(previousToken?: string): Promise<string> {
    if (this.inflight) return this.inflight;
    if (previousToken === undefined) {
      if (this.token !== null && this.clock() < this.tokenExpiresAt - REFRESH_MARGIN_MS) return Promise.resolve(this.token);
    } else if (this.token !== null && this.token !== previousToken) {
      return Promise.resolve(this.token);
    }
    this.inflight = this.fetchToken().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async fetchToken(): Promise<string> {
    // The token endpoint expects form fields (application/x-www-form-urlencoded), not JSON.
    const response = await this.fetchFn(this.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(this.timeoutMs),
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
        scope: this.scope,
      }).toString(),
    });
    if (!response.ok) throw ArgipApiError.fromResponse(response.status, await response.text());

    const { access_token, expires_in } = parseJson<{ access_token?: unknown; expires_in?: unknown }>(await response.text(), "The token server response");
    if (typeof access_token !== "string" || !access_token) throw new Error("The token server returned no access_token.");
    // If the server omits a usable expires_in, assume the documented 8 hours; NaN would disable caching.
    const lifetimeSeconds = typeof expires_in === "number" && Number.isFinite(expires_in) ? expires_in : 28800;
    this.token = access_token;
    this.tokenExpiresAt = this.clock() + lifetimeSeconds * 1000;
    return access_token;
  }
}

function requireUrl(value: string, name: string): string {
  let url: URL | undefined;
  try {
    url = new URL(value);
  } catch {
    // Falls through to the error below.
  }
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname) {
    throw new ArgipInputError(`${name} must be an absolute http(s) URL with a host, got "${value}".`);
  }
  return value;
}

function parseJson<T>(text: string, what: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${what} is not valid JSON (a proxy or a wrong URL?).`);
  }
}
