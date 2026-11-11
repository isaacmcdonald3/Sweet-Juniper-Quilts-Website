import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { logger } from "./logger.js";
import type { StorefrontBootstrap } from "@sweet-juniper/shared";

const config = loadConfig();
const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const app = createApp({
  allowedOrigins: config.allowedOrigins,
  logger,
  checkDatabase: async () => {
    const { error } = await supabase.from("products").select("id", { head: true, count: "exact" }).limit(0);
    return !error;
  },
  loadBootstrap: async (): Promise<StorefrontBootstrap> => {
    const [categoryResult, productResult, contentResult] = await Promise.all([
      supabase.from("categories").select("id,name,slug").eq("is_published", true).order("sort_order"),
      supabase
        .from("products")
        .select("id,name,description,price,product_media(media_url,alt_text,sort_order)")
        .eq("is_published", true)
        .eq("is_featured", true)
        .is("archived_at", null)
        .order("created_at", { ascending: false })
        .limit(8),
      supabase.from("homepage_content").select("content").eq("content_key", "welcome").eq("is_published", true).maybeSingle(),
    ]);

    const error = categoryResult.error || productResult.error || contentResult.error;
    if (error) throw error;

    return {
      shopName: "Sweet Juniper Quilts",
      welcomeMessage:
        typeof contentResult.data?.content === "string"
          ? contentResult.data.content
          : "A little warmth, stitched to last.",
      categories: categoryResult.data.map((category) => ({
        id: category.id,
        name: category.name,
        slug: category.slug,
      })),
      featuredProducts: productResult.data.map((product) => ({
        id: product.id,
        name: product.name,
        description: product.description || "",
        price: Number(product.price),
        currency: "USD",
        media: [...(product.product_media || [])]
          .sort((left, right) => left.sort_order - right.sort_order)
          .map((media) => ({ url: media.media_url, altText: media.alt_text })),
      })),
    };
  },
});

app.listen(config.SERVER_PORT, () => {
  logger.info({ port: config.SERVER_PORT }, "Sweet Juniper API is listening");
});
