import { hashPin } from "./auth.mjs";
import { dbMode, mutateDb } from "./db.mjs";

const PIN_PATTERN = /^\d{6,12}$/;

export async function bootstrapPostgresAdminFromEnv() {
  const pin = String(process.env.OA_BOOTSTRAP_ADMIN_PIN || "").trim();
  if (!pin) return { configured: false, applied: false };
  if (dbMode() !== "postgres") return { configured: true, applied: false, reason: "not-postgres" };
  if (!PIN_PATTERN.test(pin) || pin === "123456") {
    throw new Error("OA_BOOTSTRAP_ADMIN_PIN 必须是 6-12 位数字，且不能使用 123456");
  }

  return await mutateDb((db) => {
    const admin = (db.users || []).find((item) => item.id === "u-admin" || item.role === "admin");
    if (!admin) throw new Error("PostgreSQL 中未找到管理员账号，无法执行首次安全引导");
    if (admin.pinHash || admin.pin) {
      return { configured: true, applied: false, reason: "credentials-exist", adminId: admin.id };
    }
    admin.pinHash = hashPin(pin);
    delete admin.pin;
    admin.status = "active";
    admin.mustChangePin = true;
    return { configured: true, applied: true, adminId: admin.id };
  });
}
