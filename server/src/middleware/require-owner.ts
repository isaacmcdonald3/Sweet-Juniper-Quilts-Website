import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextFunction, Request, Response } from "express";

export function requireOwner(supabase: SupabaseClient, ownerUserId?: string) {
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
      const { data, error } = await supabase.auth.getUser(token);
      if (error || !data.user) {
        response.status(401).json({ error: "Authentication is required." });
        return;
      }
      if (data.user.id !== ownerUserId) {
        response.status(403).json({ error: "Owner access is required." });
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
