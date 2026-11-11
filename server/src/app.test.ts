import assert from "node:assert/strict";
import { test } from "node:test";
import pino from "pino";
import request from "supertest";
import type { StorefrontBootstrap } from "@sweet-juniper/shared";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const bootstrap: StorefrontBootstrap = {
  shopName: "Sweet Juniper Quilts",
  welcomeMessage: "A little warmth, stitched to last.",
  categories: [],
  featuredProducts: [],
};
let databaseReady = true;
let failBootstrap = false;
const app = createApp({
  allowedOrigins: ["https://shop.example"],
  logger: pino({ enabled: false }),
  checkDatabase: async () => databaseReady,
  loadBootstrap: async () => {
    if (failBootstrap) throw new Error("private database detail");
    return bootstrap;
  },
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

test("CORS only grants the configured customer origin", async () => {
  await request(app)
    .get("/api/health")
    .set("Origin", "https://shop.example")
    .expect("Access-Control-Allow-Origin", "https://shop.example")
    .expect(200);
  const response = await request(app).get("/api/health").set("Origin", "https://other.example").expect(200);
  assert.equal(response.headers["access-control-allow-origin"], undefined);
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
  assert.deepEqual(config.allowedOrigins, ["https://shop.example", "https://www.shop.example"]);
});
