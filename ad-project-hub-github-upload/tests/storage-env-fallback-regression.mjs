import assert from "node:assert/strict";
import { objectStorageReady, resolveStorageSettings, storageSettingsFromEnv } from "../server/storage-settings.mjs";

const keys = [
  "OBJECT_STORAGE_PROVIDER",
  "OBJECT_STORAGE_BUCKET",
  "OBJECT_STORAGE_ENDPOINT",
  "OBJECT_STORAGE_ACCESS_KEY_ID",
  "OBJECT_STORAGE_SECRET_ACCESS_KEY",
  "OBJECT_STORAGE_PUBLIC_BASE_URL"
];
const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

try {
  process.env.OBJECT_STORAGE_PROVIDER = "r2";
  process.env.OBJECT_STORAGE_BUCKET = "oa-files";
  process.env.OBJECT_STORAGE_ENDPOINT = "https://account.r2.cloudflarestorage.com";
  process.env.OBJECT_STORAGE_ACCESS_KEY_ID = "access";
  process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY = "secret";
  process.env.OBJECT_STORAGE_PUBLIC_BASE_URL = "https://files.example.com";

  const env = storageSettingsFromEnv();
  assert.equal(env.bucket, "oa-files");
  assert.equal(env.provider, "r2");
  assert.equal(objectStorageReady(env), true);

  const resolved = resolveStorageSettings({ bucket: "saved-bucket", provider: "s3" });
  assert.equal(resolved.bucket, "saved-bucket", "saved non-empty values should remain authoritative");
  assert.equal(resolved.accessKeyId, "access", "environment should fill missing secrets");
} finally {
  for (const key of keys) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
}

console.log("storage env fallback regression passed");
