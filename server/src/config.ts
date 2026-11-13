import { z } from "zod";

const optionalSecret = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().trim().min(1).optional(),
);
const optionalEmail = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().trim().email().optional(),
);
const optionalUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().trim().url().refine((value) => {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") &&
      !url.username &&
      !url.password;
  }).optional(),
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
  PAYPAL_CLIENT_ID: optionalSecret,
  PAYPAL_CLIENT_SECRET: optionalSecret,
  PAYPAL_MODE: z.enum(["sandbox", "live"]).default("sandbox"),
  PAYPAL_LIVE_PAYMENTS_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  PAYPAL_WEBHOOK_ID: optionalSecret,
  CHECKOUT_SHIPPING_AMOUNT: z.coerce.number().min(0).max(100_000).default(8),
  RESEND_API_KEY: optionalSecret,
  EMAIL_FROM: optionalEmail,
  OWNER_NOTIFICATION_EMAIL: optionalEmail,
  APPLICATION_BASE_URL: optionalUrl,
  RESEND_WEBHOOK_SECRET: optionalSecret,
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
  if (Boolean(config.PAYPAL_CLIENT_ID) !== Boolean(config.PAYPAL_CLIENT_SECRET)) {
    context.addIssue({
      code: "custom",
      message: "PayPal client ID and client secret must be configured together.",
      path: ["PAYPAL_CLIENT_SECRET"],
    });
  }
  const emailSettings = [
    config.RESEND_API_KEY,
    config.EMAIL_FROM,
    config.OWNER_NOTIFICATION_EMAIL,
    config.APPLICATION_BASE_URL,
  ];
  if (emailSettings.some(Boolean) && !emailSettings.every(Boolean)) {
    context.addIssue({
      code: "custom",
      message: "Resend API key, sender address, owner email, and application URL must be configured together.",
      path: ["RESEND_API_KEY"],
    });
  }
  if (Math.round(config.CHECKOUT_SHIPPING_AMOUNT * 100) !== config.CHECKOUT_SHIPPING_AMOUNT * 100) {
    context.addIssue({
      code: "custom",
      message: "Checkout shipping amount must be in whole cents.",
      path: ["CHECKOUT_SHIPPING_AMOUNT"],
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
    paypal: {
      clientId: result.data.PAYPAL_CLIENT_ID,
      clientSecret: result.data.PAYPAL_CLIENT_SECRET,
      mode: result.data.PAYPAL_MODE,
      livePaymentsEnabled: result.data.PAYPAL_LIVE_PAYMENTS_ENABLED,
      webhookId: result.data.PAYPAL_WEBHOOK_ID,
      shippingAmount: result.data.CHECKOUT_SHIPPING_AMOUNT,
    },
    email: {
      apiKey: result.data.RESEND_API_KEY,
      from: result.data.EMAIL_FROM,
      ownerEmail: result.data.OWNER_NOTIFICATION_EMAIL,
      baseUrl: result.data.APPLICATION_BASE_URL,
      webhookSecret: result.data.RESEND_WEBHOOK_SECRET,
    },
  };
}
