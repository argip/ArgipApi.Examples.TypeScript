// Argip API quickstart: the whole flow in one file.
//
// It reads your account, lists products, prices a basket and then SAVES AN ORDER.
// WARNING: it PLACES A REAL ORDER unless your account is in the testing phase (Step 1 tells you which).
//
// Run it with: npm run quickstart
// Exit codes: 0 = success, 1 = missing configuration, 2 = the API answered with an error or was unreachable.
import { ArgipApiClient, describeError, executionDateToday, optionsFromEnv } from "../src/index.js";
import type { OrderItem } from "../src/index.js";

try {
  await main();
} catch (error) {
  const { message, exitCode } = describeError(error);
  console.error(message);
  process.exitCode = exitCode;
}

async function main(): Promise<void> {
  // Step 0: configuration. Put ARGIP_CLIENT_ID and ARGIP_CLIENT_SECRET in .env (see .env.example).
  try {
    process.loadEnvFile();
  } catch {
    // No .env file: rely on the real environment.
  }
  const api = new ArgipApiClient(optionsFromEnv());

  // Step 1: who am I? The client fetches and caches the access token automatically on the first call.
  const customer = await api.getCustomerInfo();
  console.log(`Currency ${customer.CurrencyName ?? ""}, discount ${customer.Discount}% + ${customer.ExtraDiscount}%, testing phase: ${customer.TestingPhase}`);

  // Step 2: browse the catalogue. Pages start at 0; the X-Pagination header tells how many pages exist.
  const page = await api.getProducts(0, 5, true);
  console.log(`${page.pagination.TotalCount} active products, showing ${page.items.length}:`);
  for (const product of page.items) {
    console.log(
      `  ${String(product.ProductId).padStart(8)}  ${(product.Index ?? "").padEnd(25)} stock ${String(product.PiecesInStock).padStart(8)} pcs  ` +
        `your price ${product.YourMainPrice} ${product.CurrencyName ?? ""} / 100 pcs`,
    );
  }

  // Step 3: price a basket WITHOUT saving it. Quantities are in pieces; the API rounds up to full packages.
  // Only products with a known package size can be ordered: the quantity is one package (in pieces).
  const basket: OrderItem[] = page.items
    .filter((x) => x.SinglePackQuantityInPieces > 0)
    .slice(0, 2)
    .map((x) => ({ ProductId: x.ProductId, QuantityInPieces: x.SinglePackQuantityInPieces }));
  if (basket.length === 0) {
    console.log("No orderable products on the first page - nothing to calculate.");
    return;
  }

  const calculation = await api.calculateOrder(basket);
  console.log(`Net ${calculation.TotalNetValue} ${calculation.CurrencyName ?? ""}, gross ${calculation.TotalGrossValue}, weight ${calculation.TotalWeight} kg`);
  for (const warning of calculation.WarningMessages ?? []) console.log(`  warning type ${warning.Type} (product ${warning.ProductId}): ${warning.Comment}`);

  // Step 4: save the order to your first delivery address, to be executed today.
  // An account without addresses gets an empty page (the client turns the API's empty 404 into it).
  const address = (await api.getShippingAddresses(0, 1)).items[0];
  if (!address) {
    console.log("No delivery address on your account - ask Argip to add one, then run again.");
    return;
  }

  if (!customer.TestingPhase) console.log("WARNING: your account is NOT in the testing phase - the next step places a REAL order.");

  // If this call fails with a timeout or an empty 404, do NOT simply run it again: the order may have been
  // saved. Check with Argip first, or you may create a duplicate.
  const saved = await api.saveOrder({
    ShippingAddressId: address.ShippingAddressId,
    // The API compares this date with today's date in Poland: executionDateToday() uses the Warsaw date.
    ExecutionDate: executionDateToday(),
    // At most 30 characters.
    CustomerOrderNumber: "QUICKSTART-1",
    Comments: "Placed by the Argip API TypeScript quickstart",
    Items: basket,
  });

  // A 200 response does not mean everything was saved: items can be reduced or removed (warnings type 2 and 4).
  console.log(`Saved ${saved.Items?.length ?? 0} item(s), net ${saved.TotalNetValue} ${saved.CurrencyName ?? ""}`);
  for (const warning of saved.WarningMessages ?? []) console.log(`  warning type ${warning.Type} (product ${warning.ProductId}): ${warning.Comment}`);
}
