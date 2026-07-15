export function storageSettingsFromEnv() {
  return {
    provider: process.env.OBJECT_STORAGE_PROVIDER || process.env.STORAGE_PROVIDER || "",
    bucket: process.env.OBJECT_STORAGE_BUCKET || process.env.STORAGE_BUCKET || process.env.S3_BUCKET || "",
    endpoint: process.env.OBJECT_STORAGE_ENDPOINT || process.env.STORAGE_ENDPOINT || process.env.S3_ENDPOINT || "",
    region: process.env.OBJECT_STORAGE_REGION || process.env.STORAGE_REGION || process.env.AWS_REGION || "",
    accessKeyId: process.env.OBJECT_STORAGE_ACCESS_KEY_ID || process.env.STORAGE_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY || process.env.STORAGE_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || "",
    publicBaseUrl: process.env.OBJECT_STORAGE_PUBLIC_BASE_URL || process.env.STORAGE_PUBLIC_BASE_URL || "",
    pathPrefix: process.env.OBJECT_STORAGE_PATH_PREFIX || process.env.STORAGE_PATH_PREFIX || ""
  };
}

export function resolveStorageSettings(saved = {}) {
  const env = storageSettingsFromEnv();
  const resolved = { ...(saved || {}) };
  for (const [key, value] of Object.entries(env)) {
    if (!resolved[key] && value) resolved[key] = value;
  }
  return resolved;
}

export function objectStorageReady(settings = {}) {
  const provider = String(settings.provider || "").toLowerCase();
  return Boolean(settings.bucket && settings.accessKeyId && settings.secretAccessKey && (settings.endpoint || /s3|r2|minio/.test(provider)));
}
