import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import { pinoHttp } from "pino-http";
import { z } from "zod";
import type {
  CatalogCategory,
  CatalogProduct,
  ProductListFilters,
  StorefrontBootstrap,
  StorefrontHomepage,
} from "@sweet-juniper/shared";
import type { Logger } from "pino";

const productFiltersSchema = z.object({
  category: z.string().uuid().optional(),
  featured: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
});

export interface AppServices {
  allowedOrigins: string[];
  logger: Logger;
  checkDatabase: () => Promise<boolean>;
  loadBootstrap: () => Promise<StorefrontBootstrap>;
  loadHomepage: () => Promise<StorefrontHomepage>;
  listCategories: () => Promise<CatalogCategory[]>;
  listProducts: (filters: ProductListFilters) => Promise<CatalogProduct[]>;
  getProduct: (slug: string) => Promise<CatalogProduct | null>;
}

export function createApp(services: AppServices) {
  const app = express();
  app.disable("x-powered-by");
  app.use(pinoHttp({ logger: services.logger }));
  app.use(
    cors({
      origin: (origin, callback) => callback(null, !origin || services.allowedOrigins.includes(origin)),
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    }),
  );
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_request, response) => {
    response.json({ status: "ok" });
  });

  app.get("/api/ready", async (_request, response, next) => {
    try {
      if (!(await services.checkDatabase())) {
        response.status(503).json({ status: "unavailable" });
        return;
      }
      response.json({ status: "ready" });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/storefront/bootstrap", async (_request, response, next) => {
    try {
      response.json(await services.loadBootstrap());
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/storefront/homepage", async (_request, response, next) => {
    try {
      response.json(await services.loadHomepage());
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/categories", async (_request, response, next) => {
    try {
      response.json(await services.listCategories());
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/products", async (request, response, next) => {
    const parsedFilters = productFiltersSchema.safeParse(request.query);
    if (!parsedFilters.success) {
      response.status(400).json({ error: "Product filters are invalid." });
      return;
    }

    try {
      response.json(await services.listProducts({
        categoryId: parsedFilters.data.category,
        featured: parsedFilters.data.featured,
      }));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/products/:slug", async (request, response, next) => {
    const parsedSlug = z.string().trim().min(1).max(160).safeParse(request.params.slug);
    if (!parsedSlug.success) {
      response.status(400).json({ error: "Product address is invalid." });
      return;
    }

    try {
      const product = await services.getProduct(parsedSlug.data);
      if (!product) {
        response.status(404).json({ error: "Product not found." });
        return;
      }
      response.json(product);
    } catch (error) {
      next(error);
    }
  });

  app.use((_request, response) => {
    response.status(404).json({ error: "Not found" });
  });

  const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
    services.logger.error({ err: error }, "Unhandled request error");
    if (response.headersSent) return;
    response.status(500).json({ error: "The request could not be completed." });
  };
  app.use(errorHandler);

  return app;
}
