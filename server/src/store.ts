import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { v4 as uuid } from "uuid";
import {
  DEFAULT_SETTINGS,
  type AwakeOverrides,
  type HourlyEntry,
  type Settings,
  type Store,
  type User,
} from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "store.json");

function emptyStore(): Store {
  return {
    users: [],
    settingsByUser: {},
    entries: [],
    awakeOverridesByUser: {},
  };
}

async function ensureStore(): Promise<Store> {
  await mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<Store> & {
      settings?: Settings;
      awakeOverrides?: AwakeOverrides;
    };
    const entries = Array.isArray(parsed.entries)
      ? parsed.entries.filter((e) => typeof e.userId === "string")
      : [];
    return {
      users: Array.isArray(parsed.users)
        ? parsed.users.filter(isPasswordUser)
        : [],
      settingsByUser:
        parsed.settingsByUser && typeof parsed.settingsByUser === "object"
          ? parsed.settingsByUser
          : {},
      entries,
      awakeOverridesByUser:
        parsed.awakeOverridesByUser &&
        typeof parsed.awakeOverridesByUser === "object"
          ? parsed.awakeOverridesByUser
          : {},
    };
  } catch {
    const initial = emptyStore();
    await writeFile(DATA_FILE, JSON.stringify(initial, null, 2), "utf8");
    return initial;
  }
}

export async function getStore(): Promise<Store> {
  return ensureStore();
}

export async function saveStore(store: Store): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(DATA_FILE, JSON.stringify(store, null, 2), "utf8");
}

function isPasswordUser(value: unknown): value is User {
  if (!value || typeof value !== "object") return false;
  const u = value as Partial<User>;
  return (
    typeof u.id === "string" &&
    typeof u.username === "string" &&
    typeof u.passwordHash === "string" &&
    typeof u.passwordSalt === "string"
  );
}

export async function getUserById(id: string): Promise<User | undefined> {
  const store = await getStore();
  return store.users.find((u) => u.id === id);
}

export async function getUserByUsername(
  username: string,
): Promise<User | undefined> {
  const store = await getStore();
  return store.users.find((u) => u.username === username);
}

export async function createUser(input: {
  username: string;
  passwordHash: string;
  passwordSalt: string;
}): Promise<User> {
  const store = await getStore();
  if (store.users.some((u) => u.username === input.username)) {
    throw new Error("That username is already taken");
  }
  const user: User = {
    id: uuid(),
    username: input.username,
    passwordHash: input.passwordHash,
    passwordSalt: input.passwordSalt,
    createdAt: new Date().toISOString(),
  };
  store.users.push(user);
  store.settingsByUser[user.id] = { ...DEFAULT_SETTINGS };
  await saveStore(store);
  return user;
}

export async function getSettings(userId: string): Promise<Settings> {
  const store = await getStore();
  const existing = store.settingsByUser[userId];
  if (existing) return existing;
  const settings = { ...DEFAULT_SETTINGS };
  store.settingsByUser[userId] = settings;
  await saveStore(store);
  return settings;
}

export async function updateSettings(
  userId: string,
  patch: Partial<Settings>,
): Promise<Settings> {
  const store = await getStore();
  const current = store.settingsByUser[userId] ?? { ...DEFAULT_SETTINGS };
  const next = { ...current, ...patch };
  store.settingsByUser[userId] = next;
  await saveStore(store);
  return next;
}

export async function listEntries(
  userId: string,
  date?: string,
): Promise<HourlyEntry[]> {
  const store = await getStore();
  const entries = store.entries.filter((e) => {
    if (e.userId !== userId) return false;
    return date ? e.date === date : true;
  });
  return entries.sort((a, b) =>
    a.date === b.date ? a.hour - b.hour : a.date.localeCompare(b.date),
  );
}

export async function upsertEntry(entry: HourlyEntry): Promise<HourlyEntry> {
  const store = await getStore();
  const idx = store.entries.findIndex(
    (e) =>
      e.userId === entry.userId &&
      e.date === entry.date &&
      e.hour === entry.hour,
  );
  if (idx >= 0) {
    const previous = store.entries[idx]!;
    const merged: HourlyEntry = {
      ...previous,
      ...entry,
      id: previous.id,
      userId: previous.userId,
      createdAt: previous.createdAt,
      updatedAt: entry.updatedAt,
    };
    store.entries[idx] = merged;
    await saveStore(store);
    return merged;
  }
  store.entries.push(entry);
  await saveStore(store);
  return entry;
}

export async function getEntry(
  userId: string,
  date: string,
  hour: number,
): Promise<HourlyEntry | undefined> {
  const store = await getStore();
  return store.entries.find(
    (e) => e.userId === userId && e.date === date && e.hour === hour,
  );
}

export async function markAwake(
  userId: string,
  date: string,
  hour: number,
): Promise<number[]> {
  const store = await getStore();
  const forUser = store.awakeOverridesByUser[userId] ?? {};
  store.awakeOverridesByUser[userId] = forUser;
  const current = new Set(forUser[date] ?? []);
  current.add(hour);
  const hours = [...current].sort((a, b) => a - b);
  forUser[date] = hours;
  await saveStore(store);
  return hours;
}

export async function getAwakeHoursForDate(
  userId: string,
  date: string,
): Promise<number[]> {
  const store = await getStore();
  return store.awakeOverridesByUser[userId]?.[date] ?? [];
}
