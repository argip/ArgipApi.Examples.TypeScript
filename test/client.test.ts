import { beforeEach, describe, expect, it } from "vitest";
import { ArgipApiClient, ArgipApiError, ArgipInputError } from "../src/index.js";

const TOKEN_URL = "https://auth.test/connect/token";
const CUSTOMER = { CreditLimit: 1000, CreditAvailable: 500.5, CurrencyName: "PLN", Discount: 19, ExtraDiscount: 3, TestingPhase: true, Language: "EN" };

let requests: { url: string; init: RequestInit }[];
let apiResponses: Response[];
let tokenResponses: Response[];
let expiresIn: number;
let tokenNumber: number;
let now: number;

const fakeFetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
  const url = input.toString();
  requests.push({ url, init });
  if (url === TOKEN_URL) {
    return tokenResponses.shift() ?? Response.json({ access_token: `tok-${++tokenNumber}`, expires_in: expiresIn, token_type: "Bearer" });
  }
  const response = apiResponses.shift();
  if (!response) throw new Error("No queued API response");
  return response;
}) as typeof fetch;

const tokenRequests = () => requests.filter((x) => x.url === TOKEN_URL);
const apiRequests = () => requests.filter((x) => x.url !== TOKEN_URL);
const auth = (x: { init: RequestInit }) => new Headers(x.init.headers).get("Authorization");
const client = () =>
  new ArgipApiClient({ clientId: "id-1", clientSecret: "secret-1", apiUrl: "https://api.test/", tokenUrl: TOKEN_URL }, fakeFetch, () => now);

beforeEach(() => {
  requests = [];
  apiResponses = [];
  tokenResponses = [];
  expiresIn = 28800;
  tokenNumber = 0;
  now = 1_000_000_000;
});

describe("ArgipApiClient", () => {
  it("caches the token and sends it as Bearer", async () => {
    apiResponses.push(Response.json(CUSTOMER), Response.json(CUSTOMER));
    const api = client();

    const info = await api.getCustomerInfo();
    await api.getCustomerInfo();

    expect(tokenRequests()).toHaveLength(1);
    const form = String(tokenRequests()[0]!.init.body);
    for (const field of ["grant_type=client_credentials", "client_id=id-1", "client_secret=secret-1", "scope=argipapi"]) expect(form).toContain(field);
    expect(apiRequests().map(auth)).toEqual(["Bearer tok-1", "Bearer tok-1"]);
    expect(apiRequests()[0]!.url).toBe("https://api.test/v1/Customer/Info");
    expect(info.TestingPhase).toBe(true);
  });

  it("refreshes five minutes before expiry", async () => {
    apiResponses.push(Response.json(CUSTOMER), Response.json(CUSTOMER));
    const api = client();
    await api.getCustomerInfo();
    now += (8 * 3600 - 4 * 60) * 1000;
    await api.getCustomerInfo();
    expect(tokenRequests()).toHaveLength(2);
    expect(auth(apiRequests()[1]!)).toBe("Bearer tok-2");
  });

  it("does not reuse a short-lived token", async () => {
    expiresIn = 200;
    apiResponses.push(Response.json(CUSTOMER), Response.json(CUSTOMER));
    const api = client();
    await api.getCustomerInfo();
    await api.getCustomerInfo();
    expect(tokenRequests()).toHaveLength(2);
  });

  it("retries once after 401", async () => {
    apiResponses.push(new Response(null, { status: 401 }), Response.json(CUSTOMER));
    expect((await client().getCustomerInfo()).Language).toBe("EN");
    expect(tokenRequests()).toHaveLength(2);
    expect(auth(apiRequests()[1]!)).toBe("Bearer tok-2");
  });

  it("throws after a second 401", async () => {
    apiResponses.push(new Response(null, { status: 401 }), new Response(null, { status: 401 }));
    const error = await client().getCustomerInfo().catch((x: unknown) => x);
    expect(error).toBeInstanceOf(ArgipApiError);
    expect((error as ArgipApiError).status).toBe(401);
    expect(apiRequests()).toHaveLength(2);
  });

  it("reads the X-Pagination header", async () => {
    const pagination = { TotalCount: 16817, TotalPages: 3364, PrevPageLink: "", NextPageLink: "https://api.test/v1/Products/1/5/True" };
    apiResponses.push(Response.json([{ ProductId: 7, NearestDilivery: "-" }], { headers: { "X-Pagination": JSON.stringify(pagination) } }));
    const page = await client().getProducts(0, 5, true, "DIN 931");
    expect(apiRequests()[0]!.url).toBe("https://api.test/v1/Products/0/5/true?quickfilter=DIN%20931");
    expect(page.items[0]!.ProductId).toBe(7);
    expect(page.pagination).toEqual(pagination);
  });

  it("iterates every page", async () => {
    const headers = { "X-Pagination": JSON.stringify({ TotalCount: 2, TotalPages: 2, PrevPageLink: "", NextPageLink: "" }) };
    apiResponses.push(Response.json([{ ProductId: 1 }], { headers }), Response.json([{ ProductId: 2 }], { headers }));
    const ids: number[] = [];
    for await (const product of client().iterateAllProducts(1, false)) ids.push(product.ProductId);
    expect(ids).toEqual([1, 2]);
    expect(apiRequests().map((x) => new URL(x.url).pathname)).toEqual(["/v1/Products/0/1/false", "/v1/Products/1/1/false"]);
  });

  it("exposes the API message", async () => {
    apiResponses.push(new Response('{"message":"Bad execution date"}', { status: 400 }));
    const error = (await client().getCustomerInfo().catch((x: unknown) => x)) as ArgipApiError;
    expect([error.status, error.apiMessage, error.body]).toEqual([400, "Bad execution date", '{"message":"Bad execution date"}']);
  });

  it("handles an empty 404", async () => {
    apiResponses.push(new Response(null, { status: 404 }));
    const error = (await client().getProduct(1).catch((x: unknown) => x)) as ArgipApiError;
    expect([error.status, error.apiMessage, error.body]).toEqual([404, null, ""]);
  });

  it("sends PascalCase JSON to Order/Calculate", async () => {
    apiResponses.push(Response.json({ TotalNetValue: 12.5, Items: [], WarningMessages: [{ Type: 3, ProductId: 10, Comment: "Rounded" }] }));
    const result = await client().calculateOrder([{ ProductId: 10, QuantityInPieces: 250 }]);
    const request = apiRequests()[0]!;
    expect(request.init.method).toBe("POST");
    expect(new URL(request.url).pathname).toBe("/v1/Order/Calculate");
    expect(request.init.body).toBe('[{"ProductId":10,"QuantityInPieces":250}]');
    expect(result.WarningMessages?.[0]?.Type).toBe(3);
  });

  it("escapes path segments", async () => {
    apiResponses.push(Response.json({ ProductId: 5 }));
    await client().getProductByYourIndex("A/B 1");
    expect(apiRequests()[0]!.url).toBe("https://api.test/v1/Products/YourIndex/A%2FB%201");
  });

  it("reports token errors", async () => {
    tokenResponses.push(Response.json({ error: "invalid_client" }, { status: 400 }));
    const error = (await client().getCustomerInfo().catch((x: unknown) => x)) as ArgipApiError;
    expect([error.status, error.apiMessage]).toEqual([400, "invalid_client"]);
    expect(apiRequests()).toHaveLength(0);
  });

  it("shares one token request between concurrent calls", async () => {
    for (let i = 0; i < 5; i++) apiResponses.push(Response.json(CUSTOMER));
    const api = client();
    await Promise.all(Array.from({ length: 5 }, () => api.getCustomerInfo()));
    expect(tokenRequests()).toHaveLength(1);
  });

  it("shares one refresh when concurrent calls all get 401", async () => {
    apiResponses.push(new Response(null, { status: 401 }), new Response(null, { status: 401 }), Response.json(CUSTOMER), Response.json(CUSTOMER));
    const api = client();
    await Promise.all([api.getCustomerInfo(), api.getCustomerInfo()]);
    expect(tokenRequests()).toHaveLength(2);
    expect(apiRequests().map(auth)).toEqual(["Bearer tok-1", "Bearer tok-1", "Bearer tok-2", "Bearer tok-2"]);
  });

  it("caches a token whose expires_in is missing", async () => {
    tokenResponses.push(Response.json({ access_token: "tok-x", token_type: "Bearer" }));
    apiResponses.push(Response.json(CUSTOMER), Response.json(CUSTOMER));
    const api = client();
    await api.getCustomerInfo();
    await api.getCustomerInfo();
    expect(tokenRequests()).toHaveLength(1);
  });

  it("turns an empty 404 of a paged list into an empty page", async () => {
    apiResponses.push(new Response(null, { status: 404 }), new Response(null, { status: 404 }), new Response(null, { status: 404 }));
    const api = client();
    const empty = { items: [], pagination: { TotalCount: 0, TotalPages: 0, PrevPageLink: "", NextPageLink: "" } };
    expect(await api.getProducts(0, 5, true, "nothing")).toEqual(empty);
    expect(await api.getCustomerParts(0, 5)).toEqual(empty);
    expect(await api.getShippingAddresses(0, 5)).toEqual(empty);
  });

  it("keeps throwing for a 404 with a message or on single items", async () => {
    apiResponses.push(new Response('{"message":"Products with categoryId = 1 not found"}', { status: 404 }), new Response(null, { status: 404 }));
    const api = client();
    const withMessage = (await api.getProductsByCategory(1).catch((x: unknown) => x)) as ArgipApiError;
    expect(withMessage.apiMessage).toBe("Products with categoryId = 1 not found");
    const single = (await api.getCustomerPart(1).catch((x: unknown) => x)) as ArgipApiError;
    expect(single.status).toBe(404);
  });

  it("iterateAllProducts yields nothing for an empty list", async () => {
    apiResponses.push(new Response(null, { status: 404 }));
    const ids: number[] = [];
    for await (const product of client().iterateAllProducts(10, true)) ids.push(product.ProductId);
    expect(ids).toEqual([]);
    expect(apiRequests()).toHaveLength(1);
  });

  it("a 404 with a body on a page request still throws", async () => {
    apiResponses.push(new Response("gone", { status: 404 }));
    const error = (await client().getShippingAddresses(0, 5).catch((x: unknown) => x)) as ArgipApiError;
    expect(error).toBeInstanceOf(ArgipApiError);
  });

  it("mapProduct sends exactly the given fields (omitted ones are cleared by the API)", async () => {
    apiResponses.push(Response.json({ ProductId: 1 }));
    await client().mapProduct({ ProductId: 1, Index: "MY-1" });
    expect(apiRequests()[0]!.init.body).toBe('{"ProductId":1,"Index":"MY-1"}');
  });

  it("parses the testing phase Message of a write response and leaves it undefined otherwise", async () => {
    const message = "Testing phase: the data is valid and would be saved in the production phase.";
    apiResponses.push(Response.json({ CustomerPartsId: 0, ProductId: 5, Part: "P-1", Descrption: "", Message: message }), Response.json({ CustomerPartsId: 7, ProductId: 5, Part: "P-1", Descrption: "" }));
    const api = client();
    const testing = await api.putCustomerPart({ ProductId: 5, Part: "P-1" });
    const production = await api.getCustomerPart(5);
    expect(testing.Message).toBe(message);
    expect(testing.CustomerPartsId).toBe(0);
    expect(production.Message).toBeUndefined();
  });

  it("sends omitted optional strings as empty strings, never null", async () => {
    apiResponses.push(Response.json({}), Response.json({}));
    const api = client();
    await api.putCustomerPart({ ProductId: 5, Part: "P-1" });
    await api.putShippingAddress({
      FiendlyName: "HQ",
      PostalCode: "00-001",
      Street: "Main",
      BuildingNumber: "1",
      City: "Warsaw",
      CountryCode: "PL",
      ContactPhone: "1",
      ContactPerson: "A",
      ReceivingCompanyName: "Acme",
      Email: "a@example.com",
    });
    expect(JSON.parse(String(apiRequests()[0]!.init.body))).toEqual({ ProductId: 5, Part: "P-1", Description: "" });
    const address = JSON.parse(String(apiRequests()[1]!.init.body));
    expect(address.ReceivingCompanyName).toBe("Acme");
    expect(address.Email).toBe("a@example.com");
  });

  it("rejects a CustomerOrderNumber longer than 30 characters before sending", async () => {
    const order = { ShippingAddressId: 1, ExecutionDate: "2026-11-12T00:00:00", Items: [{ ProductId: 1, QuantityInPieces: 1 }] };
    const api = client();
    const error = await api.saveOrder({ ...order, CustomerOrderNumber: "x".repeat(31) }).catch((x: unknown) => x);
    expect(error).toBeInstanceOf(ArgipInputError);
    expect(requests).toHaveLength(0);

    apiResponses.push(Response.json({ Items: [] }));
    await api.saveOrder({ ...order, CustomerOrderNumber: "x".repeat(30) });
    expect(apiRequests()).toHaveLength(1);
  });

  it("sends a timeout signal with every request, including the token request", async () => {
    apiResponses.push(Response.json(CUSTOMER));
    await client().getCustomerInfo();
    expect(requests).toHaveLength(2);
    for (const request of requests) expect(request.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("a request that exceeds timeoutMs fails with a TimeoutError", async () => {
    const hanging = ((_input: string | URL | Request, init: RequestInit = {}) =>
      new Promise((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason)))) as typeof fetch;
    const api = new ArgipApiClient({ clientId: "a", clientSecret: "b", tokenUrl: TOKEN_URL, timeoutMs: 20 }, hanging);
    const error = (await api.getCustomerInfo().catch((x: unknown) => x)) as Error;
    expect(error.name).toBe("TimeoutError");
  });

  it("validates the URLs and the timeout up front", () => {
    const make = (extra: object) => () => new ArgipApiClient({ clientId: "a", clientSecret: "b", ...extra });
    expect(make({ apiUrl: "not a url" })).toThrow(/ARGIP_API_URL must be an absolute http\(s\) URL/);
    expect(make({ tokenUrl: "identity.example/connect/token" })).toThrow(ArgipInputError);
    for (const bad of ["ftp://x/", "localhost:5000", "http://[bad", "http://", "file:///etc/passwd"]) {
      expect(make({ apiUrl: bad }), bad).toThrow(/ARGIP_API_URL/);
      expect(make({ tokenUrl: bad }), bad).toThrow(/ARGIP_TOKEN_URL/);
    }
    expect(make({ timeoutMs: 0 })).toThrow(/timeoutMs/);
  });

  it("throws when the token request answers an empty 404, instead of returning an empty page", async () => {
    tokenResponses.push(new Response(null, { status: 404 }), new Response(null, { status: 404 }), new Response(null, { status: 404 }));
    const api = client();
    for (const call of [() => api.getProducts(0, 5, true), () => api.getCustomerParts(0, 5), () => api.getShippingAddresses(0, 5)]) {
      const error = (await call().catch((x: unknown) => x)) as ArgipApiError;
      expect(error).toBeInstanceOf(ArgipApiError);
      expect(error.status).toBe(404);
    }
    expect(apiRequests()).toHaveLength(0);
  });

  it("rejects bad paging before sending anything", async () => {
    const api = client();
    for (const call of [
      () => api.getProducts(-1, 5, true),
      () => api.getProducts(0, 0, true),
      () => api.getProducts(0, 1001, true),
      () => api.getCustomerParts(0.5, 5),
      () => api.getShippingAddresses(0, 1001),
    ]) {
      expect(await call().catch((x: unknown) => x)).toBeInstanceOf(ArgipInputError);
    }
    expect(requests).toHaveLength(0);
  });

  it("returns a page past the end as is: no items but a total count", async () => {
    const pagination = { TotalCount: 12, TotalPages: 3, PrevPageLink: "", NextPageLink: "" };
    apiResponses.push(Response.json([], { headers: { "X-Pagination": JSON.stringify(pagination) } }));
    const page = await client().getProducts(9, 5, true);
    expect(page.items).toEqual([]);
    expect(page.pagination.TotalCount).toBe(12);
  });

  it("fails clearly when the token response has no access_token or is not JSON", async () => {
    tokenResponses.push(Response.json({ token_type: "Bearer" }), new Response("<html>proxy</html>", { status: 200 }));
    const api = client();
    await expect(api.getCustomerInfo()).rejects.toThrow(/no access_token/);
    await expect(api.getCustomerInfo()).rejects.toThrow(/not valid JSON/);
    expect(apiRequests()).toHaveLength(0);
  });

  it("reports an API response that is not JSON as a protocol error", async () => {
    apiResponses.push(new Response("<html>proxy</html>", { status: 200 }));
    await expect(client().getCustomerInfo()).rejects.toThrow(/not valid JSON/);
  });
});
