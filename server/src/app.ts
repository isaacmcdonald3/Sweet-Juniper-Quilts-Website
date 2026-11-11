import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import { pinoHttp } from "pino-http";
import type { StorefrontBootstrap } from "@sweet-juniper/shared";
import type { Logger } from "pino";

export interface AppServices {
  allowedOrigins: string[];
  logger: Logger;
  checkDatabase: () => Promise<boolean>;
  loadBootstrap: () => Promise<StorefrontBootstrap>;
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
