import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createStorefrontService } from "./services/storefront-service.js";
import { createAdminService } from "./services/admin-service.js";
import { logger } from "./logger.js";

const config = loadConfig();
const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const storefront = createStorefrontService(supabase);
const admin = createAdminService(supabase);
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
});

app.listen(config.SERVER_PORT, () => {
  logger.info({ port: config.SERVER_PORT }, "Sweet Juniper API is listening");
});
