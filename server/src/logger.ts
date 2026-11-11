import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  redact: {
    paths: ["req.headers.authorization", "*.password", "*.service_role_key", "*.access_token"],
    censor: "[REDACTED]",
  },
});
