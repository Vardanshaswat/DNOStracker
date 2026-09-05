import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { NextFunction, Request, Response } from "express";
import { createUser, getUserById, getUserByUsername } from "./store.js";
import type { User } from "./types.js";

export const SESSION_COOKIE = "dnos_session";
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const scryptAsync = promisify(scrypt);
const USERNAME_RE = /^[a-zA-Z0-9_]{3,24}$/;
const dummySalt = Buffer.alloc(16, 7);

declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

type JwtPayload = {
  sub: string;
  username?: string;
  iat: number;
  exp: number;
};

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

function clientOrigins(): string[] {
  const listed = (process.env.CLIENT_ORIGINS ?? "http://127.0.0.1:4179,http://localhost:4179")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const railway = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
  if (railway) listed.push(`https://${railway}`);
  return listed;
}

function jwtSecret(): string {
  const raw = process.env.JWT_SECRET?.trim();
  if (raw) return raw;
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET is required in production");
  }
  console.warn(
    "JWT_SECRET is not set — using a local dev secret. Sessions reset if you change it.",
  );
  return "dnos-dev-only-change-me";
}

export function corsOrigin(
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
) {
  if (!origin) {
    callback(null, true);
    return;
  }
  if (clientOrigins().includes(origin)) {
    callback(null, true);
    return;
  }
  try {
    if (new URL(origin).hostname.endsWith(".up.railway.app")) {
      callback(null, true);
      return;
    }
  } catch {
    // ignore invalid Origin
  }
  callback(null, false);
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_MAX_AGE_MS,
    path: "/",
  };
}

function b64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validateCredentials(username: string, password: string): void {
  if (!USERNAME_RE.test(username)) {
    throw new AuthError(
      "Username must be 3–24 letters, numbers, or underscores",
      400,
    );
  }
  if (password.length < 8 || password.length > 128) {
    throw new AuthError("Password must be 8–128 characters", 400);
  }
}

async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = randomBytes(16);
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return {
    hash: derived.toString("base64"),
    salt: salt.toString("base64"),
  };
}

async function passwordsMatch(
  password: string,
  saltB64: string,
  hashB64: string,
): Promise<boolean> {
  try {
    const salt = Buffer.from(saltB64, "base64");
    const expected = Buffer.from(hashB64, "base64");
    const actual = (await scryptAsync(password, salt, 64)) as Buffer;
    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export async function signup(
  usernameRaw: string,
  password: string,
): Promise<User> {
  const username = normalizeUsername(usernameRaw);
  validateCredentials(username, password);
  const existing = await getUserByUsername(username);
  if (existing) {
    throw new AuthError("That username is already taken", 409);
  }
  const { hash, salt } = await hashPassword(password);
  return createUser({ username, passwordHash: hash, passwordSalt: salt });
}

export async function login(
  usernameRaw: string,
  password: string,
): Promise<User> {
  const username = normalizeUsername(usernameRaw);
  validateCredentials(username, password);
  const user = await getUserByUsername(username);
  if (!user) {
    await passwordsMatch(password, dummySalt.toString("base64"), "A".repeat(88));
    throw new AuthError("Invalid username or password", 401);
  }
  const ok = await passwordsMatch(
    password,
    user.passwordSalt,
    user.passwordHash,
  );
  if (!ok) {
    throw new AuthError("Invalid username or password", 401);
  }
  return user;
}

export function signSession(user: User): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64urlJson({ alg: "HS256", typ: "JWT" });
  const payload = b64urlJson({
    sub: user.id,
    username: user.username,
    iat: now,
    exp: now + SESSION_MAX_AGE_MS / 1000,
  } satisfies JwtPayload);
  const data = `${header}.${payload}`;
  const sig = createHmac("sha256", jwtSecret()).update(data).digest("base64url");
  return `${data}.${sig}`;
}

function verifySessionToken(token: string): JwtPayload {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid session");
  const [header, payload, signature] = parts;
  if (!header || !payload || !signature) throw new Error("Invalid session");
  const data = `${header}.${payload}`;
  const expected = createHmac("sha256", jwtSecret()).update(data).digest();
  const actual = Buffer.from(signature, "base64url");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error("Invalid session");
  }
  const parsed = JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8"),
  ) as JwtPayload;
  if (typeof parsed.sub !== "string" || typeof parsed.exp !== "number") {
    throw new Error("Invalid session");
  }
  if (parsed.exp * 1000 <= Date.now()) throw new Error("Session expired");
  return parsed;
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, cookieOptions());
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) {
    res.status(401).json({ error: "Sign in required" });
    return;
  }
  try {
    const payload = verifySessionToken(token);
    const user = await getUserById(payload.sub);
    if (!user) {
      clearSessionCookie(res);
      res.status(401).json({ error: "Sign in required" });
      return;
    }
    req.user = user;
    next();
  } catch {
    clearSessionCookie(res);
    res.status(401).json({ error: "Sign in required" });
  }
}

export function publicUser(user: User) {
  return {
    id: user.id,
    username: user.username,
  };
}
