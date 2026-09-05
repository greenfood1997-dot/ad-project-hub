const MAX = Number.MAX_SAFE_INTEGER;

export function encodeMinorAmountForPostgres(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("amount_minor must be a non-negative safe integer");
  return String(value);
}

export function decodeMinorAmountFromPostgres(value) {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("unsafe BIGINT");
    return value;
  }
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw new RangeError("invalid BIGINT");
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0 || n > MAX || String(n) !== value.replace(/^0+(?=\d)/, "")) throw new RangeError("unsafe BIGINT");
  return n;
}
