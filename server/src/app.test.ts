import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import pino from "pino";
import request from "supertest";
import { createClient } from "@supabase/supabase-js";
import type {
  CatalogCategory,
  CatalogProduct,
  ProductListFilters,
  StorefrontBootstrap,
  StorefrontHomepage,
} from "@sweet-juniper/shared";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createAdminService } from "./services/admin-service.js";
import {
  createCloudinaryService,
  UploadValidationError,
} from "./services/cloudinary-service.js";
import { createMediaService } from "./services/media-service.js";
import { createCheckoutService } from "./services/checkout-service.js";
import { createEmailService } from "./services/email-service.js";
import { renderEmail } from "./services/email-templates.js";
import { verifyResendWebhookSignature } from "./services/resend-webhook.js";

const bootstrap: StorefrontBootstrap = {
  shopName: "Sweet Juniper Quilts",
  welcomeMessage: "A little warmth, stitched to last.",
  categories: [],
  featuredProducts: [],
};
const homepage: StorefrontHomepage = {
  content: {},
  categories: [],
  featuredProducts: [],
  mediaLibrary: [],
};
let receivedFilters: ProductListFilters | undefined;
let databaseReady = true;
let failBootstrap = false;
let failCatalog = false;
const app = createApp({
  allowedOrigins: ["https://shop.example"],
  logger: pino({ enabled: false }),
  checkDatabase: async () => databaseReady,
  loadBootstrap: async () => {
    if (failBootstrap) throw new Error("private database detail");
    return bootstrap;
  },
  loadHomepage: async () => homepage,
  listCategories: async (): Promise<CatalogCategory[]> => [],
  listProducts: async (filters): Promise<CatalogProduct[]> => {
    if (failCatalog) throw new Error("private product query");
    receivedFilters = filters;
    return [];
  },
  getProduct: async (slug) =>
    slug === "handmade-quilt"
      ? {
          id: "product-id",
          name: "Handmade Quilt",
          slug,
          description: "A quilt stitched by hand.",
          price: 180,
          subcategory: null,
          categoryId: null,
          category: null,
          inventoryQuantity: 1,
          fulfillmentType: "ready_to_ship",
          isFeatured: false,
          media: [],
        }
      : null,
  ownerUserId: "owner-id",
  getAuthenticatedUserId: async (token) => {
    if (token === "owner-token") return "owner-id";
    if (token === "customer-token") return "customer-id";
    return null;
  },
  admin: createAdminService(createClient("https://project.supabase.co", "test-anon-key")),
  media: createMediaService(
    createClient("https://project.supabase.co", "test-anon-key"),
    createCloudinaryService(undefined, pino({ enabled: false })),
    pino({ enabled: false }),
  ),
  emails: createEmailService(
    createClient("https://project.supabase.co", "test-anon-key"),
    {},
    pino({ enabled: false }),
  ),
});
test("health stays available independently of database readiness", async () => {
  databaseReady = false;
  const response = await request(app).get("/api/health").expect(200);
  assert.deepEqual(response.body, { status: "ok" });
});

test("readiness requires a working database query", async () => {
  databaseReady = false;
  await request(app).get("/api/ready").expect(503, { status: "unavailable" });
  databaseReady = true;
  await request(app).get("/api/ready").expect(200, { status: "ready" });
});

test("bootstrap returns initial storefront data and hides server errors", async () => {
  await request(app).get("/api/storefront/bootstrap").expect(200, bootstrap);
  failBootstrap = true;
  const response = await request(app).get("/api/storefront/bootstrap").expect(500);
  assert.equal(response.body.error, "The request could not be completed.");
  assert.equal(JSON.stringify(response.body).includes("private database detail"), false);
  failBootstrap = false;
});

test("catalog routes expose data and validate filters and product slugs", async () => {
  await request(app).get("/api/storefront/homepage").expect(200, homepage);
  await request(app).get("/api/categories").expect(200, []);
  await request(app).get("/api/products?category=not-a-uuid&featured=true").expect(400);
  await request(app)
    .get("/api/products?category=cbf8b29c-0f99-48bb-8e5e-2f246fcdd76e&featured=true")
    .expect(200, []);
  assert.deepEqual(receivedFilters, {
    categoryId: "cbf8b29c-0f99-48bb-8e5e-2f246fcdd76e",
    featured: true,
  });
  const product = await request(app).get("/api/products/handmade-quilt").expect(200);
  assert.equal(product.body.name, "Handmade Quilt");
  await request(app).get("/api/products/not-found").expect(404);
  failCatalog = true;
  const failure = await request(app).get("/api/products").expect(500);
  assert.equal(JSON.stringify(failure.body).includes("private product query"), false);
  failCatalog = false;
});

test("CORS only grants the configured customer origin", async () => {
  await request(app)
    .get("/api/health")
    .set("Origin", "https://shop.example")
    .expect("Access-Control-Allow-Origin", "https://shop.example")
    .expect(200);
  const response = await request(app).get("/api/health").set("Origin", "https://other.example").expect(200);
  assert.equal(response.headers["access-control-allow-origin"], undefined);
});

test("administrative requests require the configured owner identity", async () => {
  await request(app).get("/api/admin/products").expect(401);
  await request(app)
    .get("/api/admin/products")
    .set("Authorization", "Bearer customer-token")
    .expect(403);
  await request(app)
    .post("/api/admin/products")
    .set("Authorization", "Bearer owner-token")
    .send({ name: "" })
    .expect(400, { error: "Product details are invalid." });
  await request(app)
    .post("/api/admin/products")
    .set("Authorization", "Bearer owner-token")
    .send({
      name: "Baby Quilt",
      description: "",
      price: 180,
      categoryId: null,
      subcategory: "Baby Quilts",
      inventoryQuantity: 1,
      lowInventoryThreshold: 2,
      fulfillmentType: "ready_to_ship",
      isPublished: true,
      isFeatured: false,
      isArchived: false,
    })
    .expect(400, { error: "Product details are invalid." });
});

test("contact form validates submissions and email logs remain owner-only", async () => {
  await request(app)
    .post("/api/contact")
    .send({ name: "Quilter", email: "not-an-email", message: "" })
    .expect(400, { error: "Enter your name, a valid email address, and a message of up to 3,000 characters." });
  await request(app).get("/api/admin/email-logs").expect(401);
});

test("media endpoints are owner-only and report when Cloudinary is not configured", async () => {
  await request(app).get("/api/admin/media/limits").expect(401);
  await request(app).get("/api/admin/homepage-media").expect(401);
  await request(app)
    .get("/api/admin/media/limits")
    .set("Authorization", "Bearer customer-token")
    .expect(403);
  await request(app)
    .get("/api/admin/media/limits")
    .set("Authorization", "Bearer owner-token")
    .expect(200, {
      configured: false,
      imageMaxBytes: 15_000_000,
      videoMaxBytes: 90_000_000,
      imageMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/avif"],
      videoMimeTypes: ["video/mp4", "video/webm", "video/quicktime"],
    });
  await request(app)
    .post("/api/admin/products/cbf8b29c-0f99-48bb-8e5e-2f246fcdd76e/media")
    .set("Authorization", "Bearer customer-token")
    .attach("file", Buffer.from("not uploaded"), { filename: "image.jpg", contentType: "image/jpeg" })
    .expect(403);
  await request(app)
    .post("/api/admin/products/cbf8b29c-0f99-48bb-8e5e-2f246fcdd76e/media")
    .set("Authorization", "Bearer owner-token")
    .attach("file", Buffer.from("not uploaded"), { filename: "image.jpg", contentType: "image/jpeg" })
    .expect(503, { error: "Media uploads are not configured yet." });
  await request(app)
    .post("/api/admin/homepage-media")
    .set("Authorization", "Bearer owner-token")
    .attach("file", Buffer.from("not uploaded"), { filename: "image.jpg", contentType: "image/jpeg" })
    .expect(503, { error: "Media uploads are not configured yet." });
});

test("owner API preflight permits authenticated administrative methods", async () => {
  const response = await request(app)
    .options("/api/admin/products/product-id")
    .set("Origin", "https://shop.example")
    .set("Access-Control-Request-Method", "PATCH")
    .set("Access-Control-Request-Headers", "authorization,content-type")
    .expect(204);
  assert.match(response.headers["access-control-allow-headers"], /authorization/i);
  assert.match(response.headers["access-control-allow-methods"], /patch/i);
});

test("configuration accepts a blank optional owner ID and uses Render's port", () => {
  const config = loadConfig({
    PORT: "10000",
    SERVER_PORT: "3001",
    CLIENT_ORIGIN: "https://shop.example, https://www.shop.example",
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-key",
    OWNER_USER_ID: "",
  });
  assert.equal(config.SERVER_PORT, 10000);
  assert.equal(config.OWNER_USER_ID, undefined);
  assert.equal(config.cloudinary, undefined);
  assert.deepEqual(config.allowedOrigins, ["https://shop.example", "https://www.shop.example"]);
  assert.equal(config.paypal.mode, "sandbox");
  assert.equal(config.paypal.livePaymentsEnabled, false);
  assert.equal(config.paypal.shippingAmount, 8);
});

test("Resend configuration is all-or-none for sending", () => {
  assert.throws(() => loadConfig({
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-key",
    RESEND_API_KEY: "re_test",
  }), /RESEND_API_KEY/);
  const config = loadConfig({
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-key",
    RESEND_API_KEY: "re_test",
    EMAIL_FROM: "orders@verified.example",
    OWNER_NOTIFICATION_EMAIL: "owner@example.com",
    APPLICATION_BASE_URL: "https://shop.example",
  });
  assert.equal(config.email.from, "orders@verified.example");
});

test("Resend webhook signatures reject modified or stale requests", () => {
  const secretBytes = Buffer.from("test signing key");
  const secret = `whsec_${secretBytes.toString("base64")}`;
  const rawBody = Buffer.from('{"type":"email.delivered"}');
  const id = "evt_123";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", secretBytes)
    .update(`${id}.${timestamp}.`)
    .update(rawBody)
    .digest("base64");
  const headers = { id, timestamp, signature: `v1,${signature}` };
  assert.equal(verifyResendWebhookSignature(secret, headers, rawBody), true);
  assert.equal(verifyResendWebhookSignature(secret, headers, Buffer.from("{}")), false);
  assert.equal(verifyResendWebhookSignature(secret, { ...headers, timestamp: "1" }, rawBody), false);
});

test("transactional templates escape user content and keep owner mail minimal", () => {
  const order = {
    orderNumber: 104,
    customerName: "<script>alert(1)</script>",
    customerEmail: "buyer@example.com",
    shippingAddress: { addressLine1: "123 Main St", city: "Portland", region: "OR", postalCode: "97201" },
    subtotal: 35,
    shippingAmount: 8,
    totalAmount: 43,
    currency: "USD",
    shippingCarrier: "USPS",
    trackingNumber: "12345",
    items: [{ name: "<Quilt>", quantity: 1, unitPrice: 35, lineTotal: 35 }],
  };
  const shipping = renderEmail("customer_shipping_confirmation", order, null, "https://shop.example");
  assert.match(shipping.html, /&lt;script&gt;/);
  assert.match(shipping.html, /Track package/);
  assert.match(shipping.text, /Tracking number: 12345/);
  const owner = renderEmail("owner_new_paid_order", order, null, "https://shop.example");
  assert.match(owner.html, /Q-1/);
  assert.doesNotMatch(owner.html, /123 Main St/);
});

test("PayPal checkout requires a webhook and keeps Live mode explicitly gated", () => {
  const supabase = createClient("https://project.supabase.co", "test-anon-key");
  const sandboxConfig = {
    paypalClientId: "sandbox-client",
    paypalClientSecret: "sandbox-secret",
    paypalMode: "sandbox" as const,
    paypalLivePaymentsEnabled: false,
    paypalWebhookId: "sandbox-webhook",
    shippingAmount: 8,
    clientOrigin: "https://shop.example",
  };
  assert.equal(createCheckoutService(supabase, sandboxConfig).getPublicConfig().configured, true);
  assert.equal(createCheckoutService(supabase, { ...sandboxConfig, paypalWebhookId: undefined }).getPublicConfig().configured, false);
  assert.equal(createCheckoutService(supabase, {
    ...sandboxConfig,
    paypalMode: "live",
  }).getPublicConfig().configured, false);
});

test("Cloudinary credentials must be configured together", () => {
  assert.throws(
    () =>
      loadConfig({
        SUPABASE_URL: "https://project.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "test-key",
        CLOUDINARY_CLOUD_NAME: "test-cloud",
      }),
    /CLOUDINARY_API_SECRET/,
  );
});

test("Cloudinary upload validation rejects unsupported formats and oversized files", async () => {
  const cloudinary = createCloudinaryService({
    cloudName: "test-cloud",
    apiKey: "test-api-key",
    apiSecret: "test-api-secret",
    imageMaxBytes: 3,
    videoMaxBytes: 4,
  }, pino({ enabled: false }));
  await assert.rejects(
    cloudinary.upload(Buffer.from("x"), "application/pdf", "image", "test"),
    UploadValidationError,
  );
  await assert.rejects(
    cloudinary.upload(Buffer.from("1234"), "image/jpeg", "image", "test"),
    UploadValidationError,
  );
});
