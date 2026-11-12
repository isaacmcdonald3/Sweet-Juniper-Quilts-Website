import type { NextFunction, Request, Response } from "express";

type GetUserId = (token: string) => Promise<string | null>;

export function requireOwner(
  getUserId: GetUserId,
  ownerUserId?: string,
) {
  return async (request: Request, response: Response, next: NextFunction) => {
    if (!ownerUserId) {
      response.status(503).json({ error: "Owner access is not configured." });
      return;
    }

    const authorization = request.header("authorization");
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) {
      response.status(401).json({ error: "Authentication is required." });
      return;
    }

    try {
      const authenticatedUserId = await getUserId(token);
      if (!authenticatedUserId) {
        response.status(401).json({ error: "Authentication is required." });
        return;
      }
      if (authenticatedUserId !== ownerUserId) {
        response.status(403).json({ error: "Owner access is required." });
        return;
      }
      response.locals.ownerUserId = authenticatedUserId;
      next();
    } catch (error) {
      next(error);
    }
  };
}
