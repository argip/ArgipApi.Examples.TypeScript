// Command-line demo of the Argip API client. Every command is one or two API calls, so this file doubles
// as a catalogue of examples: read the comment above each `case` to see which endpoint it calls.
//
//   npm run demo -- products list --size 5
//   npm run demo -- order calculate 123:250 --json
//
// Exit codes: 0 = success, 1 = bad usage or configuration, 2 = the API answered with an error or was unreachable.
import { parseArgs } from "node:util";
import { ArgipApiClient, ArgipInputError, MAX_CUSTOMER_ORDER_NUMBER_LENGTH, describeError, optionsFromEnv } from "../src/index.js";
import type { CalcOrderModel, OrderItem, OrderModel, ProductModel } from "../src/index.js";
import { printJson, printTable } from "./output.js";

const HELP = `Argip API demo

Usage: npm run demo -- <command> [options]

Commands:
  customer                                     Account info (credit, discounts, testing phase)
  categories [--main]                          All categories, or only the main ones
  category <id>                                One category with its path
  products list [--page N] [--size N] [--all-states] [--filter TEXT]
  products get <id> | ean <ean> | index <yourIndex>
  products category <id> | base <id>           Products of a category / of a base product
  products map <productId> [--index X] [--name X] [--ean X]      WRITES; REPLACES all three, an omitted one is cleared
  products tag <productId> <tagType> <value>                     WRITES a custom tag
  parts list [--page N] [--size N]             Your part numbers
  parts get <productId>
  parts put <productId> <part> [--description X]                 WRITES a part number
  parts delete <productId>                                       WRITES (deletes a part number)
  addresses list [--page N] [--size N]         Delivery addresses
  addresses get <id>
  addresses put --name X --postal-code X --street X --building X --city X --country X
                --phone X --person X --email X --company X     WRITES a new address (real data, not a draft)
  order calculate <productId:qty>...           Price a basket (saves nothing); qty is in pieces
  order save --address <id> --date <yyyy-MM-dd> [--number X] [--comments X] <productId:qty>...
                                               WRITES a REAL order unless your account is in the testing phase.
                                               --date is sent as typed; the API wants today's date in Poland or later.
                                               --number: at most 30 characters. qty must be at least 1.

Global options:
  --json                                       Print JSON instead of tables
  --help                                       Show this help

Credentials: ARGIP_CLIENT_ID and ARGIP_CLIENT_SECRET (environment or .env file).
An empty list prints "No ... found." and exits 0.`;

const UsageError = ArgipInputError;

try {
  // Load .env if it exists; variables already set in the environment keep priority.
  process.loadEnvFile();
} catch {
  // No .env file: rely on the real environment.
}

try {
  process.exitCode = await run(process.argv.slice(2));
} catch (error) {
  // Mistyped or incomplete options come from parseArgs; they are usage errors, not crashes.
  const parseError = error instanceof Error && (error as { code?: string }).code?.startsWith("ERR_PARSE_ARGS_");
  const { message, exitCode } = parseError ? { message: `${(error as Error).message}\nRun with --help for usage.`, exitCode: 1 } : describeError(error);
  console.error(message);
  process.exitCode = exitCode;
}

async function run(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      json: { type: "boolean" },
      help: { type: "boolean" },
      main: { type: "boolean" },
      "all-states": { type: "boolean" },
      page: { type: "string" },
      size: { type: "string" },
      filter: { type: "string" },
      index: { type: "string" },
      name: { type: "string" },
      ean: { type: "string" },
      description: { type: "string" },
      address: { type: "string" },
      date: { type: "string" },
      number: { type: "string" },
      comments: { type: "string" },
      "postal-code": { type: "string" },
      street: { type: "string" },
      building: { type: "string" },
      city: { type: "string" },
      country: { type: "string" },
      phone: { type: "string" },
      person: { type: "string" },
      company: { type: "string" },
      email: { type: "string" },
    },
  });

  const [command, sub, ...rest] = positionals;
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  if (!command) {
    console.log(HELP);
    return 1;
  }

  const json = values.json === true;
  const integer = (text: string | undefined, name: string): number => {
    if (text === undefined || !/^-?\d+$/.test(text) || !isInt32(Number(text))) throw new UsageError(`${name} must be a whole number that fits 32 bits, got "${text ?? ""}".`);
    return Number(text);
  };
  // The API reads page and size as route values; reject nonsense here, before any request.
  const paging = (): { page: number; size: number } => {
    const page = optionInt(values.page, 0, "--page");
    const size = optionInt(values.size, 20, "--size");
    if (page < 0) throw new UsageError(`--page must be 0 or more, got ${page}.`);
    if (size < 1 || size > 1000) throw new UsageError(`--size must be from 1 to 1000, got ${size}.`);
    return { page, size };
  };
  const optionInt = (value: string | undefined, fallback: number, name: string) => (value === undefined ? fallback : integer(value, name));
  const required = (value: string | undefined, name: string): string => {
    if (value === undefined) throw new UsageError(`Missing required option --${name}.`);
    return value;
  };
  const argument = (index: number, name: string): string => {
    const value = rest[index];
    if (value === undefined) throw new UsageError(`Missing argument <${name}>.`);
    return value;
  };
  const idArgument = (index: number, name: string): number => integer(argument(index, name), `<${name}>`);

  // In the testing phase the writes answer 200 with a `Message`: the data was validated but not saved.
  // Show it on its own line; with --json the JSON already contains it.
  const printWrite = (result: { Message?: string | null }) => {
    printJson(result);
    if (!json && result.Message) console.log(result.Message);
  };

  const productRows = (products: ProductModel[]) => {
    if (json) return printJson(products);
    printProducts(products);
  };

  // The client caches its access token, so one instance serves every call of a process.
  // It is created lazily, on the first API call: help and bad arguments are rejected before credentials are needed.
  let client: ArgipApiClient | undefined;
  const api = () => (client ??= new ArgipApiClient(optionsFromEnv()));

  switch (command) {
    // GET v1/Customer/Info
    case "customer":
      printJson(await api().getCustomerInfo());
      return 0;

    // GET v1/Categories or v1/MainCategories
    case "categories": {
      const categories = values.main ? await api().getMainCategories() : await api().getCategories();
      if (json) printJson(categories);
      else
        printTable(categories, [
          { header: "CategoryId", value: (x) => x.CategoryId },
          { header: "ParentCategoryId", value: (x) => x.ParentCategoryId },
          { header: "Name", value: (x) => x.Name },
        ]);
      return 0;
    }

    // GET v1/Categories/{id}
    case "category": {
      if (sub === undefined) throw new UsageError("Missing argument <id>.");
      printJson(await api().getCategory(integer(sub, "<id>")));
      return 0;
    }

    case "products":
      switch (sub) {
        // GET v1/Products/{page}/{size}/{activeonly}?quickfilter=
        case "list": {
          const { page, size } = paging();
          const result = await api().getProducts(page, size, !values["all-states"], values.filter);
          if (json) printJson(result);
          else if (result.items.length === 0) printEmptyPage("products", page, result.pagination);
          else {
            printProducts(result.items);
            console.log(`Page ${page + 1}/${result.pagination.TotalPages}, ${result.pagination.TotalCount} products`);
          }
          return 0;
        }
        // GET v1/Products/{id}
        case "get": {
          const id = idArgument(0, "id");
          printJson(await api().getProduct(id));
          return 0;
        }
        // GET v1/Products/Ean/{ean}
        case "ean": {
          const ean = argument(0, "ean");
          printJson(await api().getProductByEan(ean));
          return 0;
        }
        // GET v1/Products/YourIndex/{index}: finds a product by the index you set with "products map".
        // An index containing "/" cannot be found (the API does not decode %2F in the path).
        case "index": {
          const yourIndex = argument(0, "yourIndex");
          printJson(await api().getProductByYourIndex(yourIndex));
          return 0;
        }
        // GET v1/Products/Category/{id}: with no products the API answers 404 WITH a message, which is printed as an error
        case "category": {
          const id = idArgument(0, "id");
          productRows(await api().getProductsByCategory(id));
          return 0;
        }
        // GET v1/Products/BaseProduct/{id}: same as above
        case "base": {
          const id = idArgument(0, "id");
          productRows(await api().getProductsByBaseProduct(id));
          return 0;
        }
        // PUT v1/Products: WRITES your own index, name and EAN. All three are replaced: an omitted one is cleared.
        case "map": {
          const productId = idArgument(0, "productId");
          console.error("Note: this replaces the index, name and EAN of the product; every option you omit is cleared.");
          printWrite(
            await api().mapProduct({
              ProductId: productId,
              Index: values.index,
              ProductFullName: values.name,
              EanBarcode: values.ean,
            }),
          );
          return 0;
        }
        // PUT v1/CustomTag: WRITES a custom tag
        case "tag": {
          const body = { ProductId: idArgument(0, "productId"), TagType: idArgument(1, "tagType"), TagValue: argument(2, "value") };
          printWrite(await api().mapCustomTag(body));
          return 0;
        }
      }
      break;

    case "parts":
      switch (sub) {
        // GET v1/CustomerParts/{page}/{size}
        case "list": {
          const { page, size } = paging();
          const result = await api().getCustomerParts(page, size);
          if (json) printJson(result);
          else if (result.items.length === 0) printEmptyPage("parts", page, result.pagination);
          else
            printTable(result.items, [
              { header: "CustomerPartsId", value: (x) => x.CustomerPartsId },
              { header: "ProductId", value: (x) => x.ProductId },
              { header: "Part", value: (x) => x.Part },
              { header: "Descrption", value: (x) => x.Descrption },
            ]);
          return 0;
        }
        // GET v1/CustomerParts/{productId}
        case "get": {
          const productId = idArgument(0, "productId");
          printJson(await api().getCustomerPart(productId));
          return 0;
        }
        // PUT v1/CustomerParts/: WRITES your part number for a product
        case "put": {
          const body = { ProductId: idArgument(0, "productId"), Part: argument(1, "part"), Description: values.description };
          printWrite(await api().putCustomerPart(body));
          return 0;
        }
        // DELETE v1/CustomerParts/{productId}: WRITES (removes your part number)
        case "delete": {
          const productId = idArgument(0, "productId");
          printWrite(await api().deleteCustomerPart(productId));
          return 0;
        }
      }
      break;

    case "addresses":
      switch (sub) {
        // GET v1/ShippingAddress/{page}/{size}
        case "list": {
          const { page, size } = paging();
          const result = await api().getShippingAddresses(page, size);
          if (json) printJson(result);
          else if (result.items.length === 0) printEmptyPage("addresses", page, result.pagination);
          else
            printTable(result.items, [
              { header: "ShippingAddressId", value: (x) => x.ShippingAddressId },
              { header: "FiendlyName", value: (x) => x.FiendlyName },
              { header: "PostalCode", value: (x) => x.PostalCode },
              { header: "City", value: (x) => x.City },
              { header: "Street", value: (x) => x.Street },
              { header: "BuildingNumber", value: (x) => x.BuildingNumber },
            ]);
          return 0;
        }
        // GET v1/ShippingAddress/{id}
        case "get": {
          const id = idArgument(0, "id");
          printJson(await api().getShippingAddress(id));
          return 0;
        }
        // PUT v1/ShippingAddress/: WRITES a new delivery address (real data, not a draft); in the testing phase it is only validated
        case "put": {
          const body = {
            FiendlyName: required(values.name, "name"),
            PostalCode: required(values["postal-code"], "postal-code"),
            Street: required(values.street, "street"),
            BuildingNumber: required(values.building, "building"),
            City: required(values.city, "city"),
            CountryCode: required(values.country, "country"),
            ContactPhone: required(values.phone, "phone"),
            ContactPerson: required(values.person, "person"),
            Email: required(values.email, "email"),
            ReceivingCompanyName: required(values.company, "company"),
          };
          printWrite(await api().putShippingAddress(body));
          return 0;
        }
      }
      break;

    case "order":
      switch (sub) {
        // POST v1/Order/Calculate: prices a basket, saves nothing
        case "calculate": {
          const items = parseItems(rest);
          const result = await api().calculateOrder(items);
          if (json) printJson(result);
          else printOrder(result);
          return 0;
        }
        // POST v1/Order/Save: WRITES the order. Real unless the account is in the testing phase.
        case "save": {
          const items = parseItems(rest);
          const addressId = integer(required(values.address, "address"), "--address");
          const date = required(values.date, "date");
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new UsageError(`--date must look like 2026-11-12, got "${date}".`);
          const number = values.number;
          if (number !== undefined && number.length > MAX_CUSTOMER_ORDER_NUMBER_LENGTH) {
            throw new UsageError(`--number can have at most ${MAX_CUSTOMER_ORDER_NUMBER_LENGTH} characters, got ${number.length}.`);
          }

          const customer = await api().getCustomerInfo();
          const notice = json ? console.error : console.log;
          notice(`TestingPhase: ${customer.TestingPhase}`);
          if (!customer.TestingPhase) notice("WARNING: your account is NOT in the testing phase - this places a REAL order.");

          const saved = await api().saveOrder({
            ShippingAddressId: addressId,
            // The API wants a date-time without a zone; midnight means "that day". The date is sent as typed:
            // the API rejects days before today in Poland.
            ExecutionDate: `${date}T00:00:00`,
            CustomerOrderNumber: number,
            Comments: values.comments,
            Items: items,
          });
          if (json) printJson(saved);
          else printOrder(saved);
          return 0;
        }
      }
      break;
  }

  console.error(`Unknown command: ${[command, sub].filter(Boolean).join(" ")}\n`);
  console.error(HELP);
  return 1;
}

function isInt32(value: number): boolean {
  return Number.isSafeInteger(value) && value >= -2147483648 && value <= 2147483647;
}

/** An empty list is not always an empty catalogue: the page can simply be past the end. */
function printEmptyPage(what: string, page: number, pagination: { TotalCount: number; TotalPages: number }): void {
  if (pagination.TotalCount === 0) console.log(`No ${what} found.`);
  else console.log(`No ${what} on page ${page + 1} (there are ${pagination.TotalPages} pages).`);
}

/** Turns "123:250" into { ProductId: 123, QuantityInPieces: 250 }. */
function parseItems(texts: string[]): OrderItem[] {
  if (texts.length === 0) throw new UsageError("Give at least one item as <productId:quantityInPieces>, e.g. 123:250.");
  return texts.map((text) => {
    const match = /^(\d+):(\d+)$/.exec(text);
    if (!match || !isInt32(Number(match[1])) || !isInt32(Number(match[2]))) {
      throw new UsageError(`Bad item "${text}": expected <productId:quantityInPieces> (whole numbers that fit 32 bits), e.g. 123:250.`);
    }
    // The API turns a quantity of 0 into one full package without any warning, so refuse it here.
    if (Number(match[2]) < 1) throw new UsageError(`Bad item "${text}": the quantity must be at least 1.`);
    return { ProductId: Number(match[1]), QuantityInPieces: Number(match[2]) };
  });
}

function printProducts(products: ProductModel[]): void {
  printTable(products, [
    { header: "ProductId", value: (x) => x.ProductId },
    { header: "Index", value: (x) => x.Index },
    { header: "ProductFullName", value: (x) => x.ProductFullName },
    { header: "PiecesInStock", value: (x) => x.PiecesInStock },
    { header: "YourMainPrice", value: (x) => x.YourMainPrice },
  ]);
}

function printOrder(order: CalcOrderModel | OrderModel): void {
  if ("ExecutionDate" in order) {
    console.log(`ExecutionDate: ${order.ExecutionDate}`);
    console.log(`CustomerOrderNumber: ${order.CustomerOrderNumber ?? ""}`);
  }
  printTable(order.Items ?? [], [
    { header: "ProductId", value: (x) => x.Product?.ProductId },
    { header: "Index", value: (x) => x.Product?.Index },
    { header: "PiecesOrdered", value: (x) => x.PiecesOrdered },
    { header: "PiecesReceived", value: (x) => x.PiecesReceived },
    { header: "Price", value: (x) => x.Price },
    { header: "ItemNetValue", value: (x) => x.ItemNetValue },
  ]);
  console.log(`Net ${order.TotalNetValue} ${order.CurrencyName ?? ""}, gross ${order.TotalGrossValue}, tax ${order.TaxValue}, weight ${order.TotalWeight} kg`);
  for (const warning of order.WarningMessages ?? []) console.log(`Type ${warning.Type} (product ${warning.ProductId}): ${warning.Comment}`);
}
