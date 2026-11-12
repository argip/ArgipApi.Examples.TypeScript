import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const MESSAGE = "Testing phase: the data is valid and would be saved in the production phase.";

// A local stand-in for the API and the token server: the demo is a real process, so it is tested over HTTP
// on localhost, never against the real API.
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/connect/token") return void response.end(JSON.stringify({ access_token: "t", expires_in: 28800 }));
    response.end(JSON.stringify({ ShippingAddressId: 0, FiendlyName: "HQ", Message: MESSAGE }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

function runDemo(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--import", "tsx", "demo/index.ts", ...args], {
      env: { ...process.env, ARGIP_CLIENT_ID: "a", ARGIP_CLIENT_SECRET: "b", ARGIP_API_URL: baseUrl, ARGIP_TOKEN_URL: `${baseUrl}/connect/token` },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (x) => (stdout += x));
    child.stderr.on("data", (x) => (stderr += x));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

const ADDRESS = ["addresses", "put", "--name", "HQ", "--postal-code", "00-001", "--street", "Main", "--building", "1", "--city", "Warsaw", "--country", "PL", "--phone", "1", "--person", "A", "--email", "a@example.com"];

describe("demo", () => {
  it("prints the Message of a write on its own line", async () => {
    const result = await runDemo([...ADDRESS, "--company", "Acme"]);
    expect(result.code).toBe(0);
    expect(result.stdout.trimEnd().split("\n").at(-1)).toBe(MESSAGE);
  });

  it("prints nothing extra with --json", async () => {
    const result = await runDemo([...ADDRESS, "--company", "Acme", "--json"]);
    expect(result.code).toBe(0);
    expect(result.stdout.trimEnd().split("\n").at(-1)).toBe("}");
  });

  it("addresses put without --company fails with exit code 1", async () => {
    const result = await runDemo(ADDRESS);
    expect(result.code).toBe(1);
    expect(result.stderr.trim()).toBe("Missing required option --company.");
  });
});
