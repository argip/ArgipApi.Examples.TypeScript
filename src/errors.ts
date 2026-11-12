/**
 * Any non-success response. Business errors carry `apiMessage` (the API's `{"message": ...}` body, or the
 * token server's `error` code). An empty 404 can also mean an unexpected server error: for a READ, log it and
 * retry later; for a WRITE (e.g. `Order/Save`) the outcome is UNKNOWN, so never resend automatically.
 */
export class ArgipApiError extends Error {
  constructor(
    readonly status: number,
    readonly apiMessage: string | null,
    readonly body: string,
  ) {
    super(apiMessage === null ? `Argip API returned ${status}.` : `Argip API returned ${status}: ${apiMessage}`);
    this.name = "ArgipApiError";
  }

  static fromResponse(status: number, body: string): ArgipApiError {
    let message: string | null = null;
    try {
      const parsed: unknown = JSON.parse(body);
      if (typeof parsed === "object" && parsed !== null) {
        const fields = parsed as Record<string, unknown>;
        const value = fields["message"] ?? fields["error"];
        if (typeof value === "string") message = value;
      }
    } catch {
      // Empty or non-JSON body: keep message null, the raw body is still available.
    }
    return new ArgipApiError(status, message, body);
  }
}

/** Bad input or configuration detected before anything is sent (missing credentials, invalid URL, too long order number). */
export class ArgipInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArgipInputError";
  }
}

/**
 * Turns any error into a one-line message and a process exit code:
 * 1 = bad input or configuration, 2 = the API answered with an error, was unreachable or timed out.
 */
export function describeError(error: unknown): { message: string; exitCode: 1 | 2 } {
  if (error instanceof ArgipInputError) return { message: error.message, exitCode: 1 };
  if (error instanceof ArgipApiError) {
    return { message: `Error ${error.status}: ${error.apiMessage ?? (error.body || "(empty body)")}`, exitCode: 2 };
  }
  if (error instanceof Error && error.name === "TimeoutError") {
    return { message: "Network error: the request timed out.", exitCode: 2 };
  }
  if (error instanceof TypeError && error.message === "fetch failed") {
    // No answer at all (offline, DNS, firewall, wrong URL). The cause is often an AggregateError with an empty message.
    return { message: `Network error: ${error.message}${causeDetail(error.cause)}`, exitCode: 2 };
  }
  return { message: `Unexpected error: ${error instanceof Error ? error.message : String(error)}`, exitCode: 2 };
}

function causeDetail(cause: unknown): string {
  if (!(cause instanceof Error)) return "";
  const nested = (cause as { errors?: unknown }).errors;
  const detail =
    cause.message ||
    (cause as { code?: string }).code ||
    (Array.isArray(nested) ? nested.map((x) => (x instanceof Error ? x.message : String(x))).join("; ") : "");
  return detail ? ` (${detail})` : "";
}
