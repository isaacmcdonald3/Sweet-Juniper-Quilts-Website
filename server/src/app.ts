import cors from "cors";
import express, { type ErrorRequestHandler, type RequestHandler, type Response } from "express";
import multer from "multer";
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
import { AdminConflictError, createAdminService } from "./services/admin-service.js";
import {
  CloudinaryUnavailableError,
  UploadValidationError,
} from "./services/cloudinary-service.js";
import {
  MediaConflictError,
  MediaNotFoundError,
  createMediaService,
} from "./services/media-service.js";
import { requireOwner } from "./middleware/require-owner.js";

const productFiltersSchema = z.object({
  category: z.string().uuid().optional(),
  featured: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
});

const adminProductSchema = z.object({
  name: z.string().trim().min(1).max(150),
  description: z.string().max(5000),
  price: z.number().finite().min(0).max(1_000_000),
  sku: z.string().trim().min(1).max(64),
  categoryId: z.string().uuid().nullable(),
  inventoryQuantity: z.number().int().min(0).max(1_000_000),
  lowInventoryThreshold: z.number().int().min(0).max(1_000_000),
  fulfillmentType: z.enum(["ready_to_ship", "made_to_order"]),
  isPublished: z.boolean(),
  isFeatured: z.boolean(),
  isArchived: z.boolean(),
});

const adminCategorySchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(1000).nullable(),
  sortOrder: z.number().int().min(0).max(1_000_000),
  isPublished: z.boolean(),
});

const homepageContentSchema = z.object({
  content: z.union([
    z.record(z.string(), z.unknown()),
    z.array(z.unknown()),
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
  ]),
  isPublished: z.boolean(),
});

const mediaUploadSchema = z.object({
  mediaType: z.enum(["image", "video"]),
  altText: z.string().max(500).optional(),
  replaceMediaId: z.string().uuid().optional(),
});

const mediaUpdateSchema = z
  .object({
    altText: z.string().max(500).nullable().optional(),
    sortOrder: z.number().int().min(0).max(1_000_000).optional(),
    isPrimary: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0);

function getOwnerId(response: Response): string {
  const ownerId: unknown = response.locals.ownerUserId;
  if (typeof ownerId !== "string") throw new Error("Owner identity is missing from the request context.");
  return ownerId;
}

export interface AppServices {
  allowedOrigins: string[];
  logger: Logger;
  checkDatabase: () => Promise<boolean>;
  loadBootstrap: () => Promise<StorefrontBootstrap>;
  loadHomepage: () => Promise<StorefrontHomepage>;
  listCategories: () => Promise<CatalogCategory[]>;
  listProducts: (filters: ProductListFilters) => Promise<CatalogProduct[]>;
  getProduct: (slug: string) => Promise<CatalogProduct | null>;
  getAuthenticatedUserId: (token: string) => Promise<string | null>;
  ownerUserId?: string;
  admin: ReturnType<typeof createAdminService>;
  media: ReturnType<typeof createMediaService>;
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

  const admin = express.Router();
  admin.use(requireOwner(services.getAuthenticatedUserId, services.ownerUserId));

  const requireConfiguredCloudinary: RequestHandler = (_request, response, next) => {
    if (!services.media.configured) {
      response.status(503).json({ error: "Media uploads are not configured yet." });
      return;
    }
    next();
  };
  const validateProductMediaAddress: RequestHandler = (request, response, next) => {
    const productId = z.string().uuid().safeParse(request.params.id);
    if (!productId.success) {
      response.status(400).json({ error: "Product address is invalid." });
      return;
    }
    next();
  };
  const validateVideoPosterAddress: RequestHandler = (request, response, next) => {
    const productId = z.string().uuid().safeParse(request.params.id);
    const mediaId = z.string().uuid().safeParse(request.params.mediaId);
    if (!productId.success || !mediaId.success) {
      response.status(400).json({ error: "Media address is invalid." });
      return;
    }
    next();
  };

  admin.get("/media/limits", (_request, response) => {
    response.json(services.media.getUploadLimits());
  });

  admin.get("/media", async (_request, response, next) => {
    try {
      response.json(await services.media.listAllMedia());
    } catch (error) {
      next(error);
    }
  });

  admin.get("/products/:id/media", async (request, response, next) => {
    const parsedId = z.string().uuid().safeParse(request.params.id);
    if (!parsedId.success) {
      response.status(400).json({ error: "Product address is invalid." });
      return;
    }
    try {
      response.json(await services.media.listProductMedia(parsedId.data));
    } catch (error) {
      next(error);
    }
  });

  admin.post(
    "/products/:id/media",
    requireConfiguredCloudinary,
    validateProductMediaAddress,
    services.media.uploadMiddleware,
    async (request, response, next) => {
      const parsedId = z.string().uuid().safeParse(request.params.id);
      const parsed = mediaUploadSchema.safeParse(request.body);
      if (!parsedId.success || !parsed.success || !request.file) {
        response.status(400).json({ error: "Choose a supported media file and provide valid details." });
        return;
      }
      try {
        const result = await services.media.uploadProductMedia(
          getOwnerId(response),
          parsedId.data,
          request.file,
          parsed.data.mediaType,
          parsed.data.altText?.trim() || null,
          parsed.data.replaceMediaId,
        );
        response.status(201).json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  admin.patch("/products/:id/media/:mediaId", async (request, response, next) => {
    const productId = z.string().uuid().safeParse(request.params.id);
    const mediaId = z.string().uuid().safeParse(request.params.mediaId);
    const parsed = mediaUpdateSchema.safeParse(request.body);
    if (!productId.success || !mediaId.success || !parsed.success) {
      response.status(400).json({ error: "Media details are invalid." });
      return;
    }
    try {
      response.json(
        await services.media.updateProductMedia(
          getOwnerId(response),
          productId.data,
          mediaId.data,
          parsed.data,
        ),
      );
    } catch (error) {
      next(error);
    }
  });

  admin.delete("/products/:id/media/:mediaId", async (request, response, next) => {
    const productId = z.string().uuid().safeParse(request.params.id);
    const mediaId = z.string().uuid().safeParse(request.params.mediaId);
    if (!productId.success || !mediaId.success) {
      response.status(400).json({ error: "Media address is invalid." });
      return;
    }
    try {
      response.json(
        await services.media.removeProductMedia(getOwnerId(response), productId.data, mediaId.data),
      );
    } catch (error) {
      next(error);
    }
  });

  admin.post(
    "/products/:id/media/:mediaId/poster",
    requireConfiguredCloudinary,
    validateVideoPosterAddress,
    services.media.uploadMiddleware,
    async (request, response, next) => {
      const productId = z.string().uuid().safeParse(request.params.id);
      const mediaId = z.string().uuid().safeParse(request.params.mediaId);
      if (!productId.success || !mediaId.success || !request.file) {
        response.status(400).json({ error: "Choose a supported poster image." });
        return;
      }
      try {
        response.json(
          await services.media.setVideoPoster(
            getOwnerId(response),
            productId.data,
            mediaId.data,
            request.file,
          ),
        );
      } catch (error) {
        next(error);
      }
    },
  );

  admin.delete("/products/:id/media/:mediaId/poster", async (request, response, next) => {
    const productId = z.string().uuid().safeParse(request.params.id);
    const mediaId = z.string().uuid().safeParse(request.params.mediaId);
    if (!productId.success || !mediaId.success) {
      response.status(400).json({ error: "Media address is invalid." });
      return;
    }
    try {
      response.json(
        await services.media.removeVideoPoster(getOwnerId(response), productId.data, mediaId.data),
      );
    } catch (error) {
      next(error);
    }
  });

  admin.post("/media/:mediaId/retry-cleanup", async (request, response, next) => {
    const mediaId = z.string().uuid().safeParse(request.params.mediaId);
    if (!mediaId.success) {
      response.status(400).json({ error: "Media address is invalid." });
      return;
    }
    try {
      response.json(
        await services.media.retryProductMediaCleanup(getOwnerId(response), mediaId.data),
      );
    } catch (error) {
      next(error);
    }
  });

  admin.get("/overview", async (_request, response, next) => {
    try {
      response.json(await services.admin.getOverview());
    } catch (error) {
      next(error);
    }
  });

  admin.get("/products", async (_request, response, next) => {
    try {
      response.json(await services.admin.listProducts());
    } catch (error) {
      next(error);
    }
  });

  admin.post("/products", async (request, response, next) => {
    const parsed = adminProductSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "Product details are invalid." });
      return;
    }
    try {
      const actorId = getOwnerId(response);
      response.status(201).json(await services.admin.createProduct(actorId, parsed.data));
    } catch (error) {
      next(error);
    }
  });

  admin.patch("/products/:id", async (request, response, next) => {
    const parsedId = z.string().uuid().safeParse(request.params.id);
    const parsed = adminProductSchema.safeParse(request.body);
    if (!parsedId.success || !parsed.success) {
      response.status(400).json({ error: "Product details are invalid." });
      return;
    }
    try {
      const actorId = getOwnerId(response);
      const product = await services.admin.updateProduct(actorId, parsedId.data, parsed.data);
      if (!product) {
        response.status(404).json({ error: "Product not found." });
        return;
      }
      response.json(product);
    } catch (error) {
      next(error);
    }
  });

  admin.get("/categories", async (_request, response, next) => {
    try {
      response.json(await services.admin.listCategories());
    } catch (error) {
      next(error);
    }
  });

  admin.post("/categories", async (request, response, next) => {
    const parsed = adminCategorySchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "Category details are invalid." });
      return;
    }
    try {
      const actorId = getOwnerId(response);
      response.status(201).json(await services.admin.createCategory(actorId, parsed.data));
    } catch (error) {
      next(error);
    }
  });

  admin.patch("/categories/:id", async (request, response, next) => {
    const parsedId = z.string().uuid().safeParse(request.params.id);
    const parsed = adminCategorySchema.safeParse(request.body);
    if (!parsedId.success || !parsed.success) {
      response.status(400).json({ error: "Category details are invalid." });
      return;
    }
    try {
      const actorId = getOwnerId(response);
      const category = await services.admin.updateCategory(actorId, parsedId.data, parsed.data);
      if (!category) {
        response.status(404).json({ error: "Category not found." });
        return;
      }
      response.json(category);
    } catch (error) {
      next(error);
    }
  });

  admin.delete("/categories/:id", async (request, response, next) => {
    const parsedId = z.string().uuid().safeParse(request.params.id);
    if (!parsedId.success) {
      response.status(400).json({ error: "Category address is invalid." });
      return;
    }
    try {
      const actorId = getOwnerId(response);
      if (!(await services.admin.deleteCategory(actorId, parsedId.data))) {
        response.status(404).json({ error: "Category not found." });
        return;
      }
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  admin.get("/orders", async (_request, response, next) => {
    try {
      response.json(await services.admin.listOrders());
    } catch (error) {
      next(error);
    }
  });

  admin.get("/orders/:id", async (request, response, next) => {
    const parsedId = z.string().uuid().safeParse(request.params.id);
    if (!parsedId.success) {
      response.status(400).json({ error: "Order address is invalid." });
      return;
    }
    try {
      const order = await services.admin.getOrder(parsedId.data);
      if (!order) {
        response.status(404).json({ error: "Order not found." });
        return;
      }
      response.json(order);
    } catch (error) {
      next(error);
    }
  });

  admin.get("/homepage-content", async (_request, response, next) => {
    try {
      response.json(await services.admin.listHomepageContent());
    } catch (error) {
      next(error);
    }
  });

  admin.put("/homepage-content/:key", async (request, response, next) => {
    const parsedKey = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/).safeParse(request.params.key);
    const parsed = homepageContentSchema.safeParse(request.body);
    if (!parsedKey.success || !parsed.success) {
      response.status(400).json({ error: "Homepage content is invalid." });
      return;
    }
    try {
      const actorId = getOwnerId(response);
      await services.admin.saveHomepageContent(
        actorId,
        parsedKey.data,
        parsed.data.content,
        parsed.data.isPublished,
      );
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.use("/api/admin", admin);

  app.use((_request, response) => {
    response.status(404).json({ error: "Not found" });
  });

  const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
    services.logger.error({ err: error }, "Unhandled request error");
    if (response.headersSent) return;
    const databaseCode =
      typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    if (error instanceof AdminConflictError || databaseCode === "23503" || databaseCode === "23505") {
      const message =
        error instanceof AdminConflictError
          ? error.message
          : databaseCode === "23503"
            ? "This record is still in use and cannot be removed."
            : "A record with the same name or SKU already exists.";
      response.status(409).json({ error: message });
      return;
    }
    if (error instanceof MediaConflictError) {
      response.status(409).json({ error: error.message });
      return;
    }
    if (error instanceof MediaNotFoundError) {
      response.status(404).json({ error: error.message });
      return;
    }
    if (error instanceof UploadValidationError) {
      response.status(400).json({ error: error.message });
      return;
    }
    if (error instanceof CloudinaryUnavailableError) {
      response.status(503).json({ error: error.message });
      return;
    }
    if (error instanceof multer.MulterError) {
      const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      response.status(status).json({
        error: status === 413 ? "This file exceeds the maximum upload size." : "Media upload details are invalid.",
      });
      return;
    }
    response.status(500).json({ error: "The request could not be completed." });
  };
  app.use(errorHandler);

  return app;
}
