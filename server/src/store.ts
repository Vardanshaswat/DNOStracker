import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_SETTINGS,
  type AwakeOverrides,
  type HourlyEntry,
  type Settings,
  type Store,
} from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "store.json");

async function ensureStore(): Promise<Store> {
  await mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<Store>;
    return {
      settings: { ...DEFAULT_SETTINGS, ...parsed.settings },
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      awakeOverrides:
        parsed.awakeOverrides && typeof parsed.awakeOverrides === "object"
          ? parsed.awakeOverrides
          : {},
    };
  } catch {
    const initial: Store = {
      settings: DEFAULT_SETTINGS,
      entries: [],
      awakeOverrides: {},
    };
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

export async function getSettings(): Promise<Settings> {
  const store = await getStore();
  return store.settings;
}

export async function updateSettings(
  patch: Partial<Settings>,
): Promise<Settings> {
  const store = await getStore();
  store.settings = { ...store.settings, ...patch };
  await saveStore(store);
  return store.settings;
}

export async function listEntries(date?: string): Promise<HourlyEntry[]> {
  const store = await getStore();
  const entries = date
    ? store.entries.filter((e) => e.date === date)
    : store.entries;
  return entries.sort((a, b) =>
    a.date === b.date ? a.hour - b.hour : a.date.localeCompare(b.date),
  );
}

export async function upsertEntry(
  entry: HourlyEntry,
): Promise<HourlyEntry> {
  const store = await getStore();
  const idx = store.entries.findIndex(
    (e) => e.date === entry.date && e.hour === entry.hour,
  );
  if (idx >= 0) {
    const previous = store.entries[idx]!;
    const merged: HourlyEntry = {
      ...previous,
      ...entry,
      id: previous.id,
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
  date: string,
  hour: number,
): Promise<HourlyEntry | undefined> {
  const store = await getStore();
  return store.entries.find((e) => e.date === date && e.hour === hour);
}

export async function getAwakeOverrides(): Promise<AwakeOverrides> {
  const store = await getStore();
  return store.awakeOverrides ?? {};
}

export async function markAwake(
  date: string,
  hour: number,
): Promise<number[]> {
  const store = await getStore();
  if (!store.awakeOverrides) store.awakeOverrides = {};
  const current = new Set(store.awakeOverrides[date] ?? []);
  current.add(hour);
  const hours = [...current].sort((a, b) => a - b);
  store.awakeOverrides[date] = hours;
  await saveStore(store);
  return hours;
}

export async function getAwakeHoursForDate(date: string): Promise<number[]> {
  const store = await getStore();
  return store.awakeOverrides?.[date] ?? [];
}
