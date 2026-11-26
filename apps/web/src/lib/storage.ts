"use client";

import {
  AccessibilityPreferences,
  CashEntry,
  DEFAULT_PREFERENCES,
  TransactionRecord,
} from "./types";

const DB_NAME = "nairasense-offline";
const DB_VERSION = 1;
const STORE_CASH = "cash_entries";
const STORE_TX = "transactions";
const STORE_META = "meta";

function hasIndexedDB(): boolean {
  return typeof window !== "undefined" && "indexedDB" in window;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_CASH)) {
        db.createObjectStore(STORE_CASH, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_TX)) {
        db.createObjectStore(STORE_TX, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getAllFromStore<T>(storeName: string): Promise<T[]> {
  if (!hasIndexedDB()) return [];
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result as T[]) ?? []);
    req.onerror = () => reject(req.error);
  });
}

async function putInStore<T>(storeName: string, value: T, key?: IDBValidKey): Promise<void> {
  if (!hasIndexedDB()) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const req = key !== undefined ? store.put(value, key) : store.put(value);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function deleteFromStore(storeName: string, key: IDBValidKey): Promise<void> {
  if (!hasIndexedDB()) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const req = tx.objectStore(storeName).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function clearStore(storeName: string): Promise<void> {
  if (!hasIndexedDB()) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const req = tx.objectStore(storeName).clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function getMeta<T>(key: string): Promise<T | null> {
  if (!hasIndexedDB()) return null;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_META, "readonly");
    const req = tx.objectStore(STORE_META).get(key);
    req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function loadOfflineCashEntries(): Promise<CashEntry[]> {
  try {
    const entries = await getAllFromStore<CashEntry>(STORE_CASH);
    return entries.sort((a, b) => a.created_at.localeCompare(b.created_at));
  } catch {
    return [];
  }
}

export async function saveOfflineCashEntry(entry: CashEntry): Promise<void> {
  await putInStore(STORE_CASH, entry);
}

export async function deleteOfflineCashEntry(entryId: string): Promise<void> {
  await deleteFromStore(STORE_CASH, entryId);
}

export async function clearOfflineCashEntries(): Promise<void> {
  await clearStore(STORE_CASH);
}

export async function getOfflineSessionId(): Promise<string | null> {
  try {
    return await getMeta<string>("active_session_id");
  } catch {
    return null;
  }
}

export async function setOfflineSessionId(sessionId: string): Promise<void> {
  await putInStore(STORE_META, sessionId, "active_session_id");
}

export async function loadOfflineTransactions(): Promise<TransactionRecord[]> {
  try {
    const records = await getAllFromStore<TransactionRecord>(STORE_TX);
    return records.sort((a, b) => b.created_at.localeCompare(a.created_at));
  } catch {
    return [];
  }
}

export async function saveOfflineTransaction(record: TransactionRecord): Promise<void> {
  await putInStore(STORE_TX, record);
}

export async function deleteOfflineTransaction(id: string): Promise<void> {
  await deleteFromStore(STORE_TX, id);
}

export async function loadOfflinePreferences(): Promise<AccessibilityPreferences> {
  try {
    const prefs = await getMeta<AccessibilityPreferences>("preferences");
    return prefs ?? DEFAULT_PREFERENCES;
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export async function saveOfflinePreferences(prefs: AccessibilityPreferences): Promise<void> {
  await putInStore(STORE_META, prefs, "preferences");
}
