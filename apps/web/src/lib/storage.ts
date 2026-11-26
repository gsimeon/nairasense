"use client";

import {
  AccessibilityPreferences,
  CashEntry,
  ConfirmationStatus,
  DEFAULT_PREFERENCES,
  SourceType,
  TransactionRecord,
} from "./types";

const DB_NAME = "nairasense-offline";
const DB_VERSION = 2;
const STORE_CASH = "cash_entries";
const STORE_TX = "transactions";
const STORE_META = "meta";
const STORE_SYNC = "sync_queue";

export type PendingSyncItem = {
  id: string;
  namespace: string;
  kind: "cash_entry" | "transaction";
  payload:
    | {
        predicted_denomination: number | null;
        confirmed_denomination: number | null;
        confidence: number | null;
        confirmation_status: ConfirmationStatus;
      }
    | {
        amount_kobo: number | null;
        currency: "NGN";
        transaction_date: string | null;
        reference: string | null;
        sender_label: string | null;
        recipient_label: string | null;
        reported_status: string | null;
        source_type: SourceType;
        extracted_fields: Record<string, unknown>;
        user_confirmed: boolean;
      };
  attempts: number;
  status: "pending" | "failed";
  nextRetryAt: number;
  created_at: string;
};

const MAX_SYNC_ATTEMPTS = 5;

type Namespaced<T> = T & { _ns: string };

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
      if (!db.objectStoreNames.contains(STORE_SYNC)) {
        db.createObjectStore(STORE_SYNC, { keyPath: "id" });
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
    const req = tx.objectStore(storeName).getAll();
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

export async function loadOfflineCashEntries(namespace: string): Promise<CashEntry[]> {
  try {
    const entries = await getAllFromStore<Namespaced<CashEntry>>(STORE_CASH);
    return entries
      .filter((e) => e._ns === namespace)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  } catch {
    return [];
  }
}

export async function saveOfflineCashEntry(namespace: string, entry: CashEntry): Promise<void> {
  await putInStore<Namespaced<CashEntry>>(STORE_CASH, { ...entry, _ns: namespace });
}

export async function deleteOfflineCashEntry(entryId: string): Promise<void> {
  await deleteFromStore(STORE_CASH, entryId);
}

export async function clearOfflineCashEntries(namespace: string): Promise<void> {
  const entries = await loadOfflineCashEntries(namespace);
  await Promise.all(entries.map((e) => deleteFromStore(STORE_CASH, e.id)));
}

export async function getOfflineSessionId(namespace: string): Promise<string | null> {
  try {
    return await getMeta<string>(`${namespace}:active_session_id`);
  } catch {
    return null;
  }
}

export async function setOfflineSessionId(namespace: string, sessionId: string): Promise<void> {
  await putInStore(STORE_META, sessionId, `${namespace}:active_session_id`);
}

export async function loadOfflineTransactions(namespace: string): Promise<TransactionRecord[]> {
  try {
    const records = await getAllFromStore<Namespaced<TransactionRecord>>(STORE_TX);
    return records
      .filter((r) => r._ns === namespace)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  } catch {
    return [];
  }
}

export async function saveOfflineTransaction(
  namespace: string,
  record: TransactionRecord,
): Promise<void> {
  await putInStore<Namespaced<TransactionRecord>>(STORE_TX, { ...record, _ns: namespace });
}

export async function deleteOfflineTransaction(id: string): Promise<void> {
  await deleteFromStore(STORE_TX, id);
}

export async function loadOfflinePreferences(namespace: string): Promise<AccessibilityPreferences> {
  try {
    const prefs = await getMeta<AccessibilityPreferences>(`${namespace}:preferences`);
    return prefs ?? DEFAULT_PREFERENCES;
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export async function saveOfflinePreferences(
  namespace: string,
  prefs: AccessibilityPreferences,
): Promise<void> {
  await putInStore(STORE_META, prefs, `${namespace}:preferences`);
}

export async function enqueueSyncItem(item: PendingSyncItem): Promise<void> {
  await putInStore(STORE_SYNC, item);
}

export async function loadSyncQueue(namespace: string): Promise<PendingSyncItem[]> {
  try {
    const items = await getAllFromStore<PendingSyncItem>(STORE_SYNC);
    return items
      .filter((item) => item.namespace === namespace)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  } catch {
    return [];
  }
}

export async function removeSyncItem(id: string): Promise<void> {
  await deleteFromStore(STORE_SYNC, id);
}

export async function markSyncItemRetry(item: PendingSyncItem): Promise<void> {
  const nextAttempts = item.attempts + 1;
  const isFailed = nextAttempts >= MAX_SYNC_ATTEMPTS;
  const backoffMs = Math.min(60_000, 1500 * 2 ** item.attempts);
  await putInStore(STORE_SYNC, {
    ...item,
    attempts: nextAttempts,
    status: isFailed ? "failed" : "pending",
    nextRetryAt: Date.now() + backoffMs,
  });
}

export async function resetFailedSyncItems(namespace: string): Promise<void> {
  const queue = await loadSyncQueue(namespace);
  const failed = queue.filter((i) => i.status === "failed");
  await Promise.all(
    failed.map((item) =>
      putInStore(STORE_SYNC, {
        ...item,
        attempts: 0,
        status: "pending",
        nextRetryAt: 0,
      }),
    ),
  );
}
