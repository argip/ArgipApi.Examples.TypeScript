# Agents Guidelines - ArgipApi.Examples.TypeScript

Public example client for the Argip Client API (v1) in TypeScript: a client library, a console demo and a one-file quickstart. Sibling repositories built from the same contract: `ArgipApi.Examples.CSharp`, `ArgipApi.Examples.Python`, `ArgipApi.Examples.Php`.

## Structure

```
src/models.ts          # models, 1:1 with the API's JSON (PascalCase, API typos included)
src/errors.ts          # ArgipApiError, ArgipInputError, describeError (message + exit code)
src/dates.ts           # executionDateToday (Warsaw date)
src/client.ts          # ArgipApiClient (token cache, 401 retry, pagination), optionsFromEnv
src/index.ts           # re-exports
test/client.test.ts    # unit tests with a fake fetch (no network)
test/helpers.test.ts   # describeError, executionDateToday
test/demo.test.ts      # runs the demo process against a local fake server
demo/                  # CLI covering every endpoint
quickstart/            # one-file end-to-end example
```

## Commands

```
npm ci
npm test               # vitest, no network
npm run typecheck      # tsc --noEmit
npm run demo -- products list
npm run quickstart
```

Requires Node 22.12+ on an LTS line (22.12+, 24, 26+; tested on 24). `@types/node` is kept at the lowest supported major (22).

## Rules

- The API contract comes from the Argip API (source of truth) and is described in [ArgipApi.AgentGuide](https://github.com/argip/ArgipApi.AgentGuide). Never invent endpoints or fields; when the API changes, update `src/models.ts`, the client, demo, quickstart and README together.
- Keep model property names exactly as the API sends them (PascalCase), including `Descrption`, `FiendlyName`, `NearestDilivery`.
- Behaviours fixed on purpose: an empty 404 of a paged list is an empty page; writes are never retried automatically (only the 401 token retry exists); optional strings are sent as `""`, never `null`; `Email` and `ReceivingCompanyName` of a new address are required; `CustomerOrderNumber` is at most 30 characters; paging is validated locally (page >= 0, size 1-1000); `ARGIP_API_URL` / `ARGIP_TOKEN_URL` must be absolute http(s) URLs; token request errors always throw (never an empty page); every request has a timeout (`timeoutMs`, default 100 s).
- Tests must not touch the network: use the fake `fetch` passed to the client constructor.
- Never commit secrets. `.env` is git-ignored; `.env.example` stays empty. Do not run the quickstart or `order save` / `addresses put` against a live account without the owner's approval: they write real data.
- Code comments are educational on purpose: this repository teaches how to use the API.
- Files are UTF-8, LF line endings.
