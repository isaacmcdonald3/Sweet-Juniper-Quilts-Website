import { z } from "zod";

const optionalSecret = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().trim().min(1).optional(),
);

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
  CLOUDINARY_CLOUD_NAME: optionalSecret,
  CLOUDINARY_API_KEY: optionalSecret,
  CLOUDINARY_API_SECRET: optionalSecret,
  CLOUDINARY_IMAGE_MAX_BYTES: z.coerce.number().int().min(1).max(100_000_000).default(15_000_000),
  CLOUDINARY_VIDEO_MAX_BYTES: z.coerce.number().int().min(1).max(90_000_000).default(90_000_000),
}).superRefine((config, context) => {
  const credentials = [
    config.CLOUDINARY_CLOUD_NAME,
    config.CLOUDINARY_API_KEY,
    config.CLOUDINARY_API_SECRET,
  ];
  if (credentials.some(Boolean) && !credentials.every(Boolean)) {
    context.addIssue({
      code: "custom",
      message: "Cloudinary cloud name, API key, and API secret must be configured together.",
      path: ["CLOUDINARY_API_SECRET"],
    });
  }
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid server configuration: ${result.error.issues.map((issue) => issue.path.join(".")).join(", ")}`);
  }

  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = result.data;
  const cloudinary =
    CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET
      ? {
          cloudName: CLOUDINARY_CLOUD_NAME,
          apiKey: CLOUDINARY_API_KEY,
          apiSecret: CLOUDINARY_API_SECRET,
          imageMaxBytes: result.data.CLOUDINARY_IMAGE_MAX_BYTES,
          videoMaxBytes: result.data.CLOUDINARY_VIDEO_MAX_BYTES,
        }
      : undefined;

  return {
    ...result.data,
    SERVER_PORT: result.data.PORT || result.data.SERVER_PORT,
    allowedOrigins: result.data.CLIENT_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean),
    cloudinary,
  };
}
