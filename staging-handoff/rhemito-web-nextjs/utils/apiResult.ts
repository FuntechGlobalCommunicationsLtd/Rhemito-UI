/**
 * Case-insensitive & camelCase/snake_case envelope helpers for FURP `/api/v1/` responses.
 * Required on `staging_next_js` (present on `prod_main` and imported by `/pages/rewards` + `RewardAtPayment.tsx`).
 */

function toSnakeCase(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

function toCamelCase(name: string): string {
  return name.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase());
}

/**
 * Reads a field from a C# `PascalCase`, `camelCase`, or `snake_case` payload object.
 */
export function apiField<T = any>(source: any, name: string): T | undefined {
  if (!source || typeof source !== "object") return undefined;
  if (name in source && source[name] !== undefined) return source[name] as T;

  const targets = new Set([
    name.toLowerCase(),
    toSnakeCase(name).toLowerCase(),
    toCamelCase(name).toLowerCase(),
  ]);

  const matchedKey = Object.keys(source).find(
    (key) => targets.has(key.toLowerCase()) && source[key] !== undefined,
  );
  return matchedKey ? (source[matchedKey] as T) : undefined;
}

/**
 * Unwraps `furp02-core`'s `Result<T>` envelope (`{ succeeded, code, message, data }`)
 * or returns the body directly if already unwrapped.
 */
export function apiData<T = any>(body: any): T | undefined {
  if (body == null || typeof body !== "object") return body as T | undefined;
  const unwrapped =
    apiField<T>(body, "data") ??
    apiField<T>(body, "result");
  return unwrapped !== undefined ? unwrapped : (body as T);
}

/**
 * Checks whether a FURP `/api/v1/` response succeeded.
 */
export function apiSucceeded(body: any): boolean {
  if (!body || typeof body !== "object") return Boolean(body);
  const succeeded = apiField<boolean>(body, "succeeded");
  if (succeeded === false) return false;
  const responseType = String(apiField(body, "responseType") || "").toLowerCase();
  if (responseType === "error") return false;
  const code = Number(apiField(body, "code"));
  if (Number.isFinite(code) && code >= 400) return false;
  return true;
}

/**
 * Extracts a user-friendly message from a FURP `/api/v1/` response or error body.
 */
export function apiMessage(body: any, fallback = ""): string {
  if (!body) return fallback;
  if (typeof body === "string") return body;
  const direct = apiField<string>(body, "message");
  if (direct && String(direct).trim()) return String(direct).trim();
  const data = apiData(body);
  if (data && data !== body) {
    const nested = apiField<string>(data, "message");
    if (nested && String(nested).trim()) return String(nested).trim();
  }
  const errors = apiField<any>(body, "errors");
  if (Array.isArray(errors) && typeof errors[0] === "string") return errors[0];
  return fallback;
}
