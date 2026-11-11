import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65_535).optional(),
  SERVER_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  CLIENT_ORIGIN: z.string().default("http://localhost:5173"),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  OWNER_USER_ID: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().uuid().optional(),
  ),
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid server configuration: ${result.error.issues.map((issue) => issue.path.join(".")).join(", ")}`);
  }

  return {
    ...result.data,
    SERVER_PORT: result.data.PORT || result.data.SERVER_PORT,
    allowedOrigins: result.data.CLIENT_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean),
  };
}
