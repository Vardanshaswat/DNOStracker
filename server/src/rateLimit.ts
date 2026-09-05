import type { NextFunction, Request, Response } from "express";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

/** In-memory limiter for auth routes. Fine for a single-instance deploy. */
export function rateLimit(options: { windowMs: number; max: number }) {
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = `${req.path}:${clientIp(req)}`;
    const current = buckets.get(key);
    if (!current || now >= current.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      next();
      return;
    }
    current.count += 1;
    if (current.count > options.max) {
      res.status(429).json({
        error: "Too many attempts. Try again in a few minutes.",
      });
      return;
    }
    next();
  };
}
