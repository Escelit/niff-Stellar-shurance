import * as Joi from "joi";

export const validationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid("development", "production", "test")
    .default("development"),
  PORT: Joi.number().default(3000),
  DATABASE_URL: Joi.string()
    .required()
    .description("PostgreSQL connection URL"),
  REDIS_URL: Joi.string().required().description("Redis connection URL"),
  SOROBAN_RPC_URL: Joi.string().required().description("Soroban RPC endpoint"),
  // IPFS Configuration
  IPFS_PROVIDER: Joi.string()
    .valid("mock", "pinata")
    .default("mock")
    .description("IPFS provider to use"),
  PINATA_API_KEY: Joi.string().allow("").description("Pinata API key"),
  PINATA_API_SECRET: Joi.string().allow("").description("Pinata API secret"),
  PINATA_GATEWAY_URL: Joi.string()
    .default("https://gateway.pinata.cloud/ipfs")
    .description("Pinata gateway URL"),
  IPFS_MAX_FILE_SIZE: Joi.number()
    .default(52428800)
    .description("Maximum file size in bytes (default: 50MB)"),
  IPFS_MIN_FILE_SIZE: Joi.number()
    .default(1)
    .description("Minimum file size in bytes"),
  IPFS_STRIP_EXIF: Joi.boolean()
    .default(true)
    .description("Strip EXIF metadata from images"),
  // Legacy IPFS config (kept for compatibility)
  IPFS_GATEWAY: Joi.string().default("https://ipfs.io"),
  IPFS_PROJECT_ID: Joi.string().allow(""),
  IPFS_PROJECT_SECRET: Joi.string().allow(""),
  // Auth
  JWT_SECRET: Joi.string().min(32).required(),
  ADMIN_TOKEN: Joi.string().required(),
  // CORS
  // CORS_ORIGINS is deprecated — use FRONTEND_ORIGINS instead
  FRONTEND_ORIGINS: Joi.string()
    .required()
    .description("Comma-separated public frontend CORS origins")
    .custom((value: string, helpers) => {
      const nodeEnv =
        (helpers.state.ancestors[0] as Record<string, string>)?.NODE_ENV ??
        "development";
      if (nodeEnv !== "production") {
        // development / test: any non-empty string is accepted
        return value;
      }
      // production: every entry must start with https:// and none may equal '*'
      const entries = value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const entry of entries) {
        if (entry === "*") {
          return helpers.error("any.invalid", {
            message: 'FRONTEND_ORIGINS must not contain "*" in production',
          });
        }
        if (!entry.startsWith("https://")) {
          return helpers.error("any.invalid", {
            message: `FRONTEND_ORIGINS entry "${entry}" must start with https:// in production`,
          });
        }
      }
      return value;
    }),
  ADMIN_CORS_ORIGINS: Joi.string()
    .allow("")
    .default("")
    .description("Comma-separated admin UI CORS origins"),
  // Logging
  LOG_LEVEL: Joi.string()
    .default("info")
    .valid("error", "warn", "log", "verbose", "debug"),
  // Cache
  CACHE_TTL_SECONDS: Joi.number()
    .default(60)
    .description("Cache TTL in seconds"),
  // CAPTCHA (Turnstile or hCaptcha)
  CAPTCHA_PROVIDER: Joi.string()
    .valid("turnstile", "hcaptcha")
    .default("turnstile"),
  CAPTCHA_SECRET_KEY: Joi.string()
    .allow("")
    .default("dev-skip")
    .description("Server-side CAPTCHA secret"),
  CAPTCHA_SITE_KEY: Joi.string()
    .allow("")
    .description("Client-side CAPTCHA site key (exposed to frontend)"),
  // Support
  IP_HASH_SALT: Joi.string()
    .allow("")
    .default("niff-salt")
    .description("Salt for IP hashing"),
  // Multi-tenancy
  TENANT_RESOLUTION_ENABLED: Joi.boolean()
    .default(false)
    .description("Enable tenant resolution from subdomain / x-tenant-id header"),
  TENANT_BASE_DOMAIN: Joi.string()
    .default("niffyinsur.com")
    .description("Base domain for subdomain-based tenant resolution"),
  // Solvency monitoring (scheduled job + Redis snapshot for admin dashboard)
  SOLVENCY_MONITORING_ENABLED: Joi.string()
    .valid("true", "false", "1", "0")
    .default("true")
    .description(
      "When false/0, cron skips chain/DB work and writes an unknown snapshot (env string)",
    ),
  SOLVENCY_BUFFER_THRESHOLD_STROOPS: Joi.string()
    .pattern(/^\d+$/)
    .default("0")
    .description(
      "Minimum required buffer (on-chain balance − approved-unpaid claims); alert if below",
    ),
  SOLVENCY_SIMULATION_SOURCE_ACCOUNT: Joi.string()
    .allow("")
    .default("")
    .description(
      "Funded account public key used as Soroban simulation source for get_treasury_balance",
    ),
  SOLVENCY_CRON_EXPRESSION: Joi.string()
    .default("0 */15 * * * *")
    .description("Six-field cron (node-cron) for solvency checks; change via env, restart process"),
  SOLVENCY_ALERT_WEBHOOK_URL: Joi.string()
    .allow("")
    .optional()
    .description("Optional URL for solvency buffer-low POST payloads"),
  SOLVENCY_ALERT_WEBHOOK_SECRET: Joi.string()
    .allow("")
    .default("")
    .description("Optional shared secret header for solvency webhook"),
  SOLVENCY_TENANT_ID: Joi.string()
    .allow("")
    .optional()
    .description("When set, outstanding-claims sum is scoped to this tenantId"),
});
