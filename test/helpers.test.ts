import { describe, expect, it } from "vitest";
import { ArgipApiError, ArgipInputError, describeError, executionDateToday } from "../src/index.js";

describe("describeError", () => {
  it("prints API errors with exit code 2", () => {
    expect(describeError(new ArgipApiError(400, "Bad execution date", ""))).toEqual({ message: "Error 400: Bad execution date", exitCode: 2 });
    expect(describeError(new ArgipApiError(404, null, ""))).toEqual({ message: "Error 404: (empty body)", exitCode: 2 });
    expect(describeError(new ArgipApiError(502, null, "<html>"))).toEqual({ message: "Error 502: <html>", exitCode: 2 });
  });

  it("prints input errors with exit code 1", () => {
    expect(describeError(new ArgipInputError("bad"))).toEqual({ message: "bad", exitCode: 1 });
  });

  it("treats a timeout as a network error", () => {
    const timeout = new DOMException("timed out", "TimeoutError");
    expect(describeError(timeout)).toEqual({ message: "Network error: the request timed out.", exitCode: 2 });
  });

  it("describes fetch failures, also with an empty AggregateError cause", () => {
    const plain = new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED 127.0.0.1:1") });
    expect(describeError(plain).message).toBe("Network error: fetch failed (connect ECONNREFUSED 127.0.0.1:1)");
    const aggregate = new TypeError("fetch failed", { cause: new AggregateError([new Error("refused ::1"), new Error("refused 127.0.0.1")], "") });
    expect(describeError(aggregate).message).toBe("Network error: fetch failed (refused ::1; refused 127.0.0.1)");
    expect(describeError(new TypeError("fetch failed")).message).toBe("Network error: fetch failed");
  });

  it("reports anything else as unexpected, without a stack", () => {
    expect(describeError(new SyntaxError("Unexpected token"))).toEqual({ message: "Unexpected error: Unexpected token", exitCode: 2 });
  });
});

describe("executionDateToday", () => {
  it("uses the Warsaw date, not UTC", () => {
    // 23:30 UTC on 11 Nov is 00:30 on 12 Nov in Warsaw (winter time, UTC+1).
    expect(executionDateToday(new Date("2026-11-11T23:30:00Z"))).toBe("2026-11-12T00:00:00");
    expect(executionDateToday(new Date("2026-11-11T12:00:00Z"))).toBe("2026-11-11T00:00:00");
  });

  it("follows summer time", () => {
    // 22:30 UTC on 15 Jul is 00:30 on 16 Jul in Warsaw (UTC+2).
    expect(executionDateToday(new Date("2026-07-15T22:30:00Z"))).toBe("2026-07-16T00:00:00");
  });
});
