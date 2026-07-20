const TRANSIENT_DATABASE_CODES = new Set([
  "57P01", // admin_shutdown
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now / recovery mode
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "08007",
  "08P01",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT"
]);

export function isTransientDatabaseError(error) {
  const code = String(error?.code || "").toUpperCase();
  const message = String(error?.message || error || "");
  return TRANSIENT_DATABASE_CODES.has(code)
    || /database system is (?:starting up|in recovery mode|shutting down)/i.test(message)
    || /terminating connection|connection terminated unexpectedly|connection reset|server closed the connection unexpectedly/i.test(message);
}

export async function retryTransientDatabase(operation, { attempts = 4, baseDelayMs = 250 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (!isTransientDatabaseError(error) || attempt === attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * attempt));
    }
  }
  throw lastError;
}

export function publicServerError(error) {
  if (isTransientDatabaseError(error)) return "数据库正在恢复，请稍后重试。本次操作未完成。";
  return String(error?.message || "服务暂时不可用，请稍后重试");
}
