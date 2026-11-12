# ArgipApi.Examples.TypeScript

A small, dependency-free TypeScript client for the **Argip Client API** (B2B REST API: browse products, check stock and prices, calculate and place orders; OAuth 2.0 client credentials), plus a console demo and a one-file quickstart.

## What this is

- `src/` - the client (`ArgipApiClient`), typed models, `ArgipApiError` and `describeError`. It uses only the built-in `fetch`.
- `demo/` - a command-line tool that exercises every endpoint.
- `quickstart/quickstart.ts` - the whole flow in one readable file: token, products, price a basket, save an order.
- `test/` - unit tests with a fake `fetch` (no network needed).

The API itself is documented in [ArgipApi.AgentGuide](https://github.com/argip/ArgipApi.AgentGuide). It is written for humans and AI coding agents alike.

## Requirements

Node.js 22.12 or newer on an even-numbered (LTS) line: 22.12+, 24 or 26+ (tested on Node 24 LTS). The dev tools (vitest) do not support Node 23 or 25.

## Setup

```bash
npm ci
cp .env.example .env     # then fill in ARGIP_CLIENT_ID and ARGIP_CLIENT_SECRET
```

npm 12 may print `npm warn install-scripts 1 package had install scripts blocked ... esbuild`. Do not approve it: tsx and vitest work without that script, so just ignore the warning.

Credentials (client id and secret) are issued by Argip: write to export@argip.com.pl. `.env` is git-ignored; never commit it.

## Run the quickstart

```bash
npm run quickstart
```

> **Warning:** the quickstart ends by saving an order. It is a **real order** unless your account is in the testing phase (step 1 prints `testing phase: true/false`). Read `quickstart/quickstart.ts` before running it with a live account.

## Run the demo

```bash
npm run demo -- <command> [options]
```

Add `--json` to any command for JSON instead of tables. Commands that change data are marked **WRITES**.

| Command | What it does |
|---|---|
| `customer` | Account info: credit, discounts, testing phase |
| `categories [--main]` | All categories, or only the main ones |
| `category <id>` | One category with its path |
| `products list [--page N] [--size N] [--all-states] [--filter TEXT]` | One page of products |
| `products get <id>` / `ean <ean>` / `index <yourIndex>` | One product |
| `products category <id>` / `base <id>` | Products of a category / of a base product |
| `products map <productId> [--index X] [--name X] [--ean X]` | **WRITES** your own index, name and EAN. **All three are replaced: an option you omit is cleared** |
| `products tag <productId> <tagType> <value>` | **WRITES** a custom tag |
| `parts list [--page N] [--size N]` / `get <productId>` | Your part numbers |
| `parts put <productId> <part> [--description X]` | **WRITES** a part number |
| `parts delete <productId>` | **WRITES** (deletes a part number) |
| `addresses list [--page N] [--size N]` / `get <id>` | Delivery addresses |
| `addresses put --name X --postal-code X --street X --building X --city X --country X --phone X --person X --email X --company X` | **WRITES** a new delivery address (all options are required) |
| `order calculate <productId:qty>...` | Prices a basket, saves nothing |
| `order save --address <id> --date <yyyy-MM-dd> [--number X] [--comments X] <productId:qty>...` | **WRITES** an order: real unless `TestingPhase` is true. `--date` is sent as typed (the API wants today's date in Poland or later); `--number` has at most 30 characters; quantities must be at least 1 |

Examples:

```bash
npm run demo -- products list --size 5 --filter "DIN 931"
npm run demo -- order calculate 123:250 456:1000
npm run demo -- order save --address 42 --date 2026-11-12 --number PO-1 123:250
```

An empty list prints `No products found.` (or parts, addresses) and exits with 0. Exit codes: `0` success, `1` bad usage or configuration (unknown option, missing value, invalid URL, missing credentials), `2` the API returned an error, could not be reached or timed out (`Network error: <message>`). `--help` prints the help and exits with 0.

## Use the client in your project

Copy `src/` into your project (or import from it). Create **one** client per application: it caches the access token (valid for 8 hours) and refreshes it itself. Run a script like the one below with `npx tsx app.ts`, or compile it with `tsc` (module `NodeNext`). Running `node app.ts` (built-in type stripping) is not supported: the sources use `.js` import specifiers and constructor parameter properties.

```ts
import { ArgipApiClient, optionsFromEnv } from "./src/index.js";

const api = new ArgipApiClient(optionsFromEnv());

const page = await api.getProducts(0, 20, true, "DIN 931");
console.log(page.pagination.TotalCount, page.items[0]?.Index);

const calculation = await api.calculateOrder([{ ProductId: 123, QuantityInPieces: 250 }]);
console.log(calculation.TotalNetValue, calculation.WarningMessages);
```

Failures throw `ArgipApiError` with `status`, `apiMessage` and the raw `body`. Every request has a timeout (default 100 seconds, `timeoutMs` option); a timeout fails with a `TimeoutError`, which `describeError` reports as a network error. An empty list (the API answers an empty 404) comes back as an empty page. `describeError(error)` turns any failure into a one-line message and an exit code.

## Things that surprise people

Details are in the [agent guide](https://github.com/argip/ArgipApi.AgentGuide).

1. **Quantities are in pieces; prices are per 100 pieces** ([quantities and prices](https://github.com/argip/ArgipApi.AgentGuide/blob/master/docs/quantities-and-prices.md)).
2. **`Order/Save` places a REAL order** unless `Customer/Info` says `TestingPhase = true`. A 200 response does not mean it was saved: check `Items` (empty = nothing saved) and `WarningMessages`. `Order/Calculate` does not reserve stock. In the testing phase the other writes (custom tags, product mapping, customer parts, shipping addresses) are validated but not saved, and their response has a `Message` field ([orders](https://github.com/argip/ArgipApi.AgentGuide/blob/master/docs/orders.md)).
3. **An unexpected server error comes back as an EMPTY 404, not 500**. For a READ, log it and retry later. For a WRITE (`Order/Save` and the other `PUT`/`DELETE`/`POST` calls) an empty 404 or a timeout means the outcome is **unknown**: never resend automatically, check with Argip first, or the order may be duplicated. The same empty 404 is also how the API reports an empty list (the client turns it into an empty page) ([errors](https://github.com/argip/ArgipApi.AgentGuide/blob/master/docs/errors.md)).
4. **Tokens**: request them with form fields (not JSON), cache them for their lifetime (8 h), refresh shortly before expiry, and retry once after 401 ([authentication](https://github.com/argip/ArgipApi.AgentGuide/blob/master/docs/authentication.md)).
5. **Limits and naming**: pages start at 0 and `pagesize` is 1-1000; max 500 items per order; `CustomerOrderNumber` has at most 30 characters; the `ExecutionDate` of an order is compared with today's date in Poland (use `executionDateToday()`); a quantity of 0 or less orders one full package without a warning; `MultiPackQuantityInPieces` is the number of single packs in a multipack, not pieces; `products map` replaces all three fields (index, name, EAN); an index containing `/` cannot be found with `getProductByYourIndex`; some field names are misspelled on purpose and must be used as-is (`NearestDilivery`, `Descrption`, `FiendlyName`) ([endpoints](https://github.com/argip/ArgipApi.AgentGuide/blob/master/docs/endpoints.md)).

## Tests

```bash
npm test
npm run typecheck
```

## License

MIT, see [LICENSE](LICENSE).
