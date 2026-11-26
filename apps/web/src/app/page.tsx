"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { AuthBar } from "@/components/AuthBar";
import { CashSensePanel } from "@/components/CashSensePanel";
import { PreferencesPanel } from "@/components/PreferencesPanel";
import { TransactionSensePanel } from "@/components/TransactionSensePanel";
import {
  addCashEntryToApi,
  createCashSession,
  createTransactionInApi,
  deleteCashEntryFromApi,
  deleteTransactionFromApi,
  fetchCurrentUser,
  fetchPreferencesFromApi,
  getStoredToken,
  listCashSessionsFromApi,
  listTransactionsFromApi,
  savePreferencesToApi,
} from "@/lib/api";
import { repeatLastSpoken, speakText, stopSpeaking } from "@/lib/speech";
import {
  clearOfflineCashEntries,
  deleteOfflineCashEntry,
  deleteOfflineTransaction,
  enqueueSyncItem,
  getOfflineSessionId,
  loadOfflineCashEntries,
  loadOfflinePreferences,
  loadOfflineTransactions,
  loadSyncQueue,
  markSyncItemRetry,
  removeSyncItem,
  resetFailedSyncItems,
  saveOfflineCashEntry,
  saveOfflinePreferences,
  saveOfflineTransaction,
  setOfflineSessionId,
} from "@/lib/storage";
import {
  AccessibilityPreferences,
  CashEntry,
  ConfirmationStatus,
  DEFAULT_PREFERENCES,
  SourceType,
  TransactionRecord,
} from "@/lib/types";

type ActiveTab = "cash" | "transactions" | "settings";
const TAB_ORDER: ActiveTab[] = ["cash", "transactions", "settings"];

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("cash");
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [authUsername, setAuthUsername] = useState<string | null>(null);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [failedSyncCount, setFailedSyncCount] = useState(0);
  const syncInFlightRef = useRef(false);
  const pendingResyncRef = useRef<{ userId: string; sessionId: string | null; epoch: number } | null>(
    null,
  );
  const accountEpochRef = useRef(0);
  const tabRefs = useRef<Record<ActiveTab, HTMLButtonElement | null>>({
    cash: null,
    transactions: null,
    settings: null,
  });

  const [preferences, setPreferences] = useState<AccessibilityPreferences>(DEFAULT_PREFERENCES);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [cashEntries, setCashEntries] = useState<CashEntry[]>([]);
  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [status, setStatus] = useState("");

  const activeNamespace = authUserId ?? "guest";

  function handleTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, current: ActiveTab) {
    const idx = TAB_ORDER.indexOf(current);
    let nextIdx: number | null = null;
    if (event.key === "ArrowRight") nextIdx = (idx + 1) % TAB_ORDER.length;
    else if (event.key === "ArrowLeft") nextIdx = (idx - 1 + TAB_ORDER.length) % TAB_ORDER.length;
    else if (event.key === "Home") nextIdx = 0;
    else if (event.key === "End") nextIdx = TAB_ORDER.length - 1;

    if (nextIdx !== null) {
      event.preventDefault();
      const nextTab = TAB_ORDER[nextIdx];
      setActiveTab(nextTab);
      tabRefs.current[nextTab]?.focus();
    }
  }

  const announce = useCallback(
    (message: string, shouldSpeak = false) => {
      setStatus(message);
      if (shouldSpeak) {
        speakText(message, {
          enabled: preferences.speech_enabled,
          rate: preferences.speech_rate,
        });
      }
    },
    [preferences.speech_enabled, preferences.speech_rate],
  );

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.textSize = preferences.text_size;
    root.dataset.contrast = preferences.high_contrast ? "high" : "normal";
  }, [preferences.text_size, preferences.high_contrast]);

  useEffect(() => {
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  const updateSyncCounters = useCallback((queue: { status?: string }[]) => {
    setFailedSyncCount(queue.filter((i) => i.status === "failed").length);
    setPendingSyncCount(queue.filter((i) => i.status !== "failed").length);
  }, []);

  const flushSyncQueue = useCallback(
    async (userId: string, existingSessionId: string | null, epoch: number) => {
      if (syncInFlightRef.current) {
        // Queue a follow-up flush for the requesting account so it is never dropped
        pendingResyncRef.current = { userId, sessionId: existingSessionId, epoch };
        return;
      }
      syncInFlightRef.current = true;
      try {
        const queue = await loadSyncQueue(userId);
        if (accountEpochRef.current !== epoch) return;
        updateSyncCounters(queue);

        const nowMs = Date.now();
        const readyItems = queue.filter((i) => i.status !== "failed" && (i.nextRetryAt ?? 0) <= nowMs);
        if (readyItems.length === 0) return;

        let activeSession = existingSessionId;
        for (const item of readyItems) {
          if (accountEpochRef.current !== epoch) return;
          try {
            if (item.kind === "cash_entry") {
              if (!activeSession) {
                const session = await createCashSession();
                if (accountEpochRef.current !== epoch) return;
                activeSession = session.id;
                setSessionId(activeSession);
                await setOfflineSessionId(userId, activeSession);
              }
              const created = await addCashEntryToApi(
                activeSession,
                item.payload as {
                  predicted_denomination: number | null;
                  confirmed_denomination: number | null;
                  confidence: number | null;
                  confirmation_status: ConfirmationStatus;
                },
                item.id,
              );
              await deleteOfflineCashEntry(item.id);
              await saveOfflineCashEntry(userId, { ...created, synced: true });
              await removeSyncItem(item.id);
            } else if (item.kind === "transaction") {
              const saved = await createTransactionInApi(
                item.payload as {
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
                },
                item.id,
              );
              await deleteOfflineTransaction(item.id);
              await saveOfflineTransaction(userId, { ...saved, synced: true });
              await removeSyncItem(item.id);
            }
          } catch {
            await markSyncItemRetry(item);
          }
        }

        if (accountEpochRef.current !== epoch) return;
        const remaining = await loadSyncQueue(userId);
        updateSyncCounters(remaining);
        const [freshCash, freshTx] = await Promise.all([
          loadOfflineCashEntries(userId),
          loadOfflineTransactions(userId),
        ]);
        if (accountEpochRef.current !== epoch) return;
        setCashEntries(freshCash);
        setTransactions(freshTx);
      } finally {
        syncInFlightRef.current = false;
        const queued = pendingResyncRef.current;
        if (queued && queued.epoch === accountEpochRef.current) {
          pendingResyncRef.current = null;
          void flushSyncQueue(queued.userId, queued.sessionId, queued.epoch);
        }
      }
    },
    [updateSyncCounters],
  );

  const loadAccountState = useCallback(
    async (userId: string | null) => {
      const epoch = ++accountEpochRef.current;
      const ns = userId ?? "guest";
      const [localPrefs, localEntries, localTx, storedSessionId, queue] = await Promise.all([
        loadOfflinePreferences(ns),
        loadOfflineCashEntries(ns),
        loadOfflineTransactions(ns),
        getOfflineSessionId(ns),
        loadSyncQueue(ns),
      ]);
      if (accountEpochRef.current !== epoch) return;
      setPreferences(localPrefs);
      setCashEntries(localEntries);
      setTransactions(localTx);
      setSessionId(storedSessionId);
      updateSyncCounters(queue);

      if (!userId) return;

      try {
        await flushSyncQueue(userId, storedSessionId, epoch);
        if (accountEpochRef.current !== epoch) return;
        const [remotePrefs, remoteTx, remoteSessions] = await Promise.all([
          fetchPreferencesFromApi(),
          listTransactionsFromApi(),
          listCashSessionsFromApi(),
        ]);
        if (accountEpochRef.current !== epoch) return;
        setPreferences(remotePrefs);
        await saveOfflinePreferences(ns, remotePrefs);

        // Restore latest remote cash session and reconcile with unsynced local entries
        if (remoteSessions.length > 0) {
          const latest = remoteSessions[0];
          setSessionId(latest.id);
          await setOfflineSessionId(ns, latest.id);
          const currentLocalCash = await loadOfflineCashEntries(ns);
          const unsyncedCash = currentLocalCash.filter((e) => !e.synced);
          const remoteEntries = latest.entries.map((e) => ({ ...e, synced: true }));
          const mergedCash = [
            ...remoteEntries,
            ...unsyncedCash.filter((u) => !remoteEntries.some((r) => r.id === u.id)),
          ];
          setCashEntries(mergedCash);
          await Promise.all(
            latest.entries.map((e) => saveOfflineCashEntry(ns, { ...e, synced: true })),
          );
        } else if (!storedSessionId) {
          const session = await createCashSession();
          if (accountEpochRef.current !== epoch) return;
          setSessionId(session.id);
          await setOfflineSessionId(ns, session.id);
        }

        // Reconcile remote transaction list cleanly (including empty remote lists)
        const currentLocalTx = await loadOfflineTransactions(ns);
        const unsyncedLocal = currentLocalTx.filter((t) => !t.synced);
        const merged = [
          ...unsyncedLocal,
          ...remoteTx
            .filter((r) => !unsyncedLocal.some((u) => u.id === r.id))
            .map((tx) => ({ ...tx, synced: true })),
        ];
        setTransactions(merged);
        await Promise.all(
          currentLocalTx
            .filter((t) => t.synced && !remoteTx.some((r) => r.id === t.id))
            .map((stale) => deleteOfflineTransaction(stale.id)),
        );
        await Promise.all(remoteTx.map((tx) => saveOfflineTransaction(ns, { ...tx, synced: true })));
      } catch {
        // Offline or API unavailable; partitioned IndexedDB remains active.
      }
    },
    [flushSyncQueue, updateSyncCounters],
  );

  // Initial hydration: verify token if present, then load partitioned IndexedDB state
  useEffect(() => {
    let cancelled = false;
    async function hydrate() {
      if (getStoredToken()) {
        try {
          const me = await fetchCurrentUser();
          if (cancelled) return;
          setAuthUserId(me.user_id);
          setAuthUsername(me.username);
          await loadAccountState(me.user_id);
          return;
        } catch {
          // Token expired or API offline; fall back to guest namespace
        }
      }
      if (!cancelled) {
        await loadAccountState(null);
      }
    }
    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [loadAccountState]);

  // Flush sync queue automatically when browser regains connectivity
  useEffect(() => {
    if (!authUserId) return;
    const epoch = accountEpochRef.current;
    const handleOnline = () => {
      void flushSyncQueue(authUserId, sessionId, epoch);
    };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [authUserId, flushSyncQueue, sessionId]);

  async function handleAddCashEntry(input: {
    predicted_denomination: number | null;
    confirmed_denomination: number | null;
    confidence: number | null;
    confirmation_status: ConfirmationStatus;
  }) {
    const localId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `local-${Date.now()}`;
    let activeSession = sessionId;

    if (authUserId) {
      try {
        if (!activeSession) {
          const session = await createCashSession();
          activeSession = session.id;
          setSessionId(activeSession);
          await setOfflineSessionId(activeNamespace, activeSession);
        }
        const created = await addCashEntryToApi(activeSession, input, localId);
        const syncedEntry: CashEntry = { ...created, synced: true };
        setCashEntries((prev) => [...prev, syncedEntry]);
        await saveOfflineCashEntry(activeNamespace, syncedEntry);
        return;
      } catch {
        // Queue for durable retry when back online
        await enqueueSyncItem({
          id: localId,
          namespace: activeNamespace,
          kind: "cash_entry",
          payload: input,
          attempts: 0,
          status: "pending",
          nextRetryAt: Date.now() + 1500,
          created_at: new Date().toISOString(),
        });
        setPendingSyncCount((c) => c + 1);
      }
    }

    const offlineEntry: CashEntry = {
      id: localId,
      session_id: activeSession ?? "offline-session",
      predicted_denomination: input.predicted_denomination,
      confirmed_denomination: input.confirmed_denomination,
      confidence: input.confidence,
      confirmation_status: input.confirmation_status,
      created_at: new Date().toISOString(),
      synced: false,
    };
    setCashEntries((prev) => [...prev, offlineEntry]);
    await saveOfflineCashEntry(activeNamespace, offlineEntry);
  }

  async function handleDeleteCashEntry(entryId: string) {
    setCashEntries((prev) => prev.filter((item) => item.id !== entryId));
    await deleteOfflineCashEntry(entryId);
    await removeSyncItem(entryId);
    if (authUserId) {
      try {
        await deleteCashEntryFromApi(entryId);
      } catch {
        // Already removed locally
      }
    }
  }

  async function handleClearCashSession() {
    setCashEntries([]);
    await clearOfflineCashEntries(activeNamespace);
    if (authUserId) {
      try {
        const session = await createCashSession();
        setSessionId(session.id);
        await setOfflineSessionId(activeNamespace, session.id);
        return;
      } catch {
        // Offline
      }
    }
    setSessionId(null);
  }

  async function handleSaveTransaction(payload: {
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
  }) {
    const localId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `tx-${Date.now()}`;

    if (authUserId) {
      try {
        const saved = await createTransactionInApi(payload, localId);
        const synced: TransactionRecord = { ...saved, synced: true };
        setTransactions((prev) => [synced, ...prev]);
        await saveOfflineTransaction(activeNamespace, synced);
        return;
      } catch {
        await enqueueSyncItem({
          id: localId,
          namespace: activeNamespace,
          kind: "transaction",
          payload,
          attempts: 0,
          status: "pending",
          nextRetryAt: Date.now() + 1500,
          created_at: new Date().toISOString(),
        });
        setPendingSyncCount((c) => c + 1);
      }
    }

    const now = new Date().toISOString();
    const offlineRecord: TransactionRecord = {
      id: localId,
      ...payload,
      created_at: now,
      updated_at: now,
      synced: false,
    };
    setTransactions((prev) => [offlineRecord, ...prev]);
    await saveOfflineTransaction(activeNamespace, offlineRecord);
  }

  async function handleDeleteTransaction(id: string) {
    setTransactions((prev) => prev.filter((item) => item.id !== id));
    await deleteOfflineTransaction(id);
    await removeSyncItem(id);
    if (authUserId) {
      try {
        await deleteTransactionFromApi(id);
      } catch {
        // Already removed locally
      }
    }
  }

  async function handleUpdatePreferences(next: AccessibilityPreferences) {
    setPreferences(next);
    await saveOfflinePreferences(activeNamespace, next);
    if (authUserId) {
      try {
        await savePreferencesToApi(next);
      } catch {
        // Saved locally
      }
    }
    announce("Accessibility and voice preferences updated.", false);
  }

  const syncLabel = !authUserId
    ? "Local-only mode"
    : failedSyncCount > 0
      ? `${failedSyncCount} sync failed`
      : pendingSyncCount > 0
        ? `${pendingSyncCount} pending sync`
        : "Synced";

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>

      <div className="shell">
        <header className="topbar">
          <a className="brand" href="/" aria-label="NairaSense home">
            NairaSense
          </a>
          <div className="voice-controls" role="region" aria-label="MoneyVoice and account controls">
            <span className="tag" aria-live="polite">
              {syncLabel}
            </span>
            {authUserId && failedSyncCount > 0 && (
              <button
                type="button"
                className="secondary small-btn"
                onClick={async () => {
                  await resetFailedSyncItems(authUserId);
                  await flushSyncQueue(authUserId, sessionId, accountEpochRef.current);
                  announce("Retrying failed sync items.", true);
                }}
              >
                Retry failed syncs
              </button>
            )}
            <AuthBar
              username={authUsername}
              onAuthChange={async (user) => {
                setAuthUserId(user?.userId ?? null);
                setAuthUsername(user?.username ?? null);
                // Clear in-memory state immediately before loading the target namespace
                setCashEntries([]);
                setTransactions([]);
                setSessionId(null);
                await loadAccountState(user?.userId ?? null);
              }}
              onAnnounce={announce}
            />
            <button
              type="button"
              className="secondary small-btn"
              onClick={() => {
                if (!repeatLastSpoken(preferences.speech_rate)) {
                  announce("Nothing has been spoken yet.", false);
                }
              }}
            >
              Repeat
            </button>
            <button
              type="button"
              className="secondary small-btn"
              onClick={() => {
                stopSpeaking();
                announce("Speech stopped.", false);
              }}
            >
              Stop voice
            </button>
          </div>
        </header>

        <nav className="tabs" role="tablist" aria-label="NairaSense sections">
          <button
            id="tab-cash"
            ref={(el) => {
              tabRefs.current.cash = el;
            }}
            type="button"
            role="tab"
            tabIndex={activeTab === "cash" ? 0 : -1}
            aria-selected={activeTab === "cash"}
            aria-controls="panel-cash"
            className={activeTab === "cash" ? "tab active" : "tab"}
            onClick={() => setActiveTab("cash")}
            onKeyDown={(e) => handleTabKeyDown(e, "cash")}
          >
            CashSense
          </button>
          <button
            id="tab-transactions"
            ref={(el) => {
              tabRefs.current.transactions = el;
            }}
            type="button"
            role="tab"
            tabIndex={activeTab === "transactions" ? 0 : -1}
            aria-selected={activeTab === "transactions"}
            aria-controls="panel-transactions"
            className={activeTab === "transactions" ? "tab active" : "tab"}
            onClick={() => setActiveTab("transactions")}
            onKeyDown={(e) => handleTabKeyDown(e, "transactions")}
          >
            TransactionSense
          </button>
          <button
            id="tab-settings"
            ref={(el) => {
              tabRefs.current.settings = el;
            }}
            type="button"
            role="tab"
            tabIndex={activeTab === "settings" ? 0 : -1}
            aria-selected={activeTab === "settings"}
            aria-controls="panel-settings"
            className={activeTab === "settings" ? "tab active" : "tab"}
            onClick={() => setActiveTab("settings")}
            onKeyDown={(e) => handleTabKeyDown(e, "settings")}
          >
            Voice &amp; Display
          </button>
        </nav>

        <main id="main-content" tabIndex={-1}>
          {activeTab === "cash" && (
            <CashSensePanel
              entries={cashEntries}
              voiceLanguage={preferences.voice_language ?? "en-NG"}
              cuesEnabled={preferences.cues_enabled ?? true}
              onAddEntry={handleAddCashEntry}
              onDeleteEntry={handleDeleteCashEntry}
              onClearSession={handleClearCashSession}
              onAnnounce={announce}
              onRepeatVoice={() => {
                if (!repeatLastSpoken(preferences.speech_rate)) {
                  announce("Nothing has been spoken yet.", false);
                }
              }}
              onStopVoice={() => {
                stopSpeaking();
                announce("Speech stopped.", false);
              }}
            />
          )}

          {activeTab === "transactions" && (
            <TransactionSensePanel
              records={transactions}
              onSaveRecord={handleSaveTransaction}
              onDeleteRecord={handleDeleteTransaction}
              onAnnounce={announce}
            />
          )}

          {activeTab === "settings" && (
            <PreferencesPanel
              preferences={preferences}
              onChange={handleUpdatePreferences}
              onTestVoice={() =>
                speakText(
                  "MoneyVoice is active. NairaSense will read confirmed totals and transaction summaries aloud.",
                  { enabled: true, rate: preferences.speech_rate, force: true },
                )
              }
            />
          )}

          <p className="status" role="status" aria-live="polite">
            {status}
          </p>
        </main>

        <footer>
          <p>
            NairaSense is an accessibility prototype. It does not verify payments, authenticate
            banknotes or initiate transfers.
          </p>
        </footer>
      </div>
    </>
  );
}
