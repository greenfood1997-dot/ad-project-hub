import { hashPin } from "./auth.mjs";
import { dbMode, mutateDb } from "./db.mjs";

const PIN_PATTERN = /^\d{6,12}$/;

const DEFAULT_ACCOUNT_IDS = new Set(["u-shareholder", "u-admin", "u-director", "u-pm", "u-sales", "u-finance", "u-member"]);

export async function bootstrapPostgresAdminFromEnv() {
  const pin = String(process.env.OA_BOOTSTRAP_ADMIN_PIN || "").trim();
  if (!pin) return { configured: false, applied: false };
  if (!PIN_PATTERN.test(pin) || pin === "123456") {
    throw new Error("OA_BOOTSTRAP_ADMIN_PIN 必须是 6-12 位数字，且不能使用 123456");
  }

  return await mutateDb((db) => {
    const admin = (db.users || []).find((item) => item.id === "u-admin" || item.role === "admin");
    if (!admin) throw new Error("OA 中未找到管理员账号，无法执行首次安全引导");
    const insecureDefault = admin.pin === "123456" && DEFAULT_ACCOUNT_IDS.has(admin.id);
    if ((admin.pinHash || admin.pin) && !insecureDefault) {
      return { configured: true, applied: false, reason: "credentials-exist", adminId: admin.id };
    }
    admin.pinHash = hashPin(pin);
    delete admin.pin;
    admin.status = "active";
    admin.mustChangePin = true;
    let disabledDefaultAccounts = 0;
    for (const account of db.users || []) {
      if (account.id === admin.id || !DEFAULT_ACCOUNT_IDS.has(account.id) || account.pin !== "123456") continue;
      delete account.pin;
      delete account.pinHash;
      account.status = "disabled";
      account.mustChangePin = true;
      disabledDefaultAccounts += 1;
    }
    return { configured: true, applied: true, adminId: admin.id, storageMode: dbMode(), disabledDefaultAccounts };
  });
}
