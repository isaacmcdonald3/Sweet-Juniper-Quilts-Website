import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createStorefrontService } from "./services/storefront-service.js";
import { createAdminService } from "./services/admin-service.js";
import { createCloudinaryService } from "./services/cloudinary-service.js";
import { createMediaService } from "./services/media-service.js";
import { createCheckoutService } from "./services/checkout-service.js";
import { logger } from "./logger.js";

const config = loadConfig();
const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const cloudinary = createCloudinaryService(config.cloudinary, logger, {
  imageMaxBytes: config.CLOUDINARY_IMAGE_MAX_BYTES,
  videoMaxBytes: config.CLOUDINARY_VIDEO_MAX_BYTES,
});
const storefront = createStorefrontService(supabase, cloudinary);
const admin = createAdminService(supabase);
const media = createMediaService(supabase, cloudinary, logger);
const checkout = createCheckoutService(supabase, {
  paypalClientId: config.paypal.clientId,
  paypalClientSecret: config.paypal.clientSecret,
  paypalMode: config.paypal.mode,
  paypalLivePaymentsEnabled: config.paypal.livePaymentsEnabled,
  paypalWebhookId: config.paypal.webhookId,
  shippingAmount: config.paypal.shippingAmount,
  clientOrigin: config.allowedOrigins[0] || "http://localhost:5173",
});
const app = createApp({
  allowedOrigins: config.allowedOrigins,
  logger,
  checkDatabase: storefront.checkDatabase,
  loadBootstrap: storefront.loadBootstrap,
  loadHomepage: storefront.loadHomepage,
  listCategories: storefront.listCategories,
  listProducts: storefront.listProducts,
  getProduct: storefront.getProduct,
  ownerUserId: config.OWNER_USER_ID,
  getAuthenticatedUserId: async (token) => {
    const { data, error } = await supabase.auth.getUser(token);
    return error ? null : data.user?.id || null;
  },
  admin,
  media,
  checkout,
});

const reservationCleanup = setInterval(() => {
  void checkout.expireReservations().catch((error: unknown) => {
    logger.error({ err: error }, "Expired checkout reservations could not be released");
  });
}, 60_000);
reservationCleanup.unref();
void checkout.expireReservations().catch((error: unknown) => {
  logger.error({ err: error }, "Expired checkout reservations could not be released at startup");
});

app.listen(config.SERVER_PORT, () => {
  logger.info({ port: config.SERVER_PORT }, "Sweet Juniper API is listening");
});
