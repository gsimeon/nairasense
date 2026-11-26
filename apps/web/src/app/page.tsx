"use client";

import { useCallback, useEffect, useState } from "react";

import { CashSensePanel } from "@/components/CashSensePanel";
import { PreferencesPanel } from "@/components/PreferencesPanel";
import { TransactionSensePanel } from "@/components/TransactionSensePanel";
import {
  addCashEntryToApi,
  createCashSession,
  createTransactionInApi,
  deleteCashEntryFromApi,
  deleteTransactionFromApi,
  fetchPreferencesFromApi,
  listTransactionsFromApi,
  savePreferencesToApi,
} from "@/lib/api";
import { repeatLastSpoken, speakText, stopSpeaking } from "@/lib/speech";
import {
  clearOfflineCashEntries,
  deleteOfflineCashEntry,
  deleteOfflineTransaction,
  getOfflineSessionId,
  loadOfflineCashEntries,
  loadOfflinePreferences,
  loadOfflineTransactions,
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

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("cash");
  const [preferences, setPreferences] = useState<AccessibilityPreferences>(DEFAULT_PREFERENCES);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [cashEntries, setCashEntries] = useState<CashEntry[]>([]);
  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [status, setStatus] = useState("");

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

  // Apply text size and high contrast attributes to <html>, and register PWA service worker
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

  // Initial hydration from IndexedDB, then sync with backend API if available
  useEffect(() => {
    let cancelled = false;
    async function hydrate() {
      const [localPrefs, localEntries, localTx, storedSessionId] = await Promise.all([
        loadOfflinePreferences(),
        loadOfflineCashEntries(),
        loadOfflineTransactions(),
        getOfflineSessionId(),
      ]);
      if (cancelled) return;
      setPreferences(localPrefs);
      setCashEntries(localEntries);
      setTransactions(localTx);
      setSessionId(storedSessionId);

      try {
        const [remotePrefs, remoteTx] = await Promise.all([
          fetchPreferencesFromApi(),
          listTransactionsFromApi(),
        ]);
        if (cancelled) return;
        setPreferences(remotePrefs);
        await saveOfflinePreferences(remotePrefs);

        if (remoteTx.length > 0) {
          setTransactions(remoteTx);
          await Promise.all(remoteTx.map((tx) => saveOfflineTransaction(tx)));
        }

        if (!storedSessionId) {
          const session = await createCashSession();
          if (!cancelled) {
            setSessionId(session.id);
            await setOfflineSessionId(session.id);
          }
        }
      } catch {
        // Offline or API not running; IndexedDB state remains active.
      }
    }
    hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

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

    try {
      if (!activeSession) {
        const session = await createCashSession();
        activeSession = session.id;
        setSessionId(activeSession);
        await setOfflineSessionId(activeSession);
      }
      const created = await addCashEntryToApi(activeSession, input);
      const syncedEntry: CashEntry = { ...created, synced: true };
      setCashEntries((prev) => [...prev, syncedEntry]);
      await saveOfflineCashEntry(syncedEntry);
    } catch {
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
      await saveOfflineCashEntry(offlineEntry);
    }
  }

  async function handleDeleteCashEntry(entryId: string) {
    setCashEntries((prev) => prev.filter((item) => item.id !== entryId));
    await deleteOfflineCashEntry(entryId);
    try {
      await deleteCashEntryFromApi(entryId);
    } catch {
      // Already removed locally
    }
  }

  async function handleClearCashSession() {
    setCashEntries([]);
    await clearOfflineCashEntries();
    try {
      const session = await createCashSession();
      setSessionId(session.id);
      await setOfflineSessionId(session.id);
    } catch {
      setSessionId(null);
    }
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
    try {
      const saved = await createTransactionInApi(payload);
      const synced: TransactionRecord = { ...saved, synced: true };
      setTransactions((prev) => [synced, ...prev]);
      await saveOfflineTransaction(synced);
    } catch {
      const now = new Date().toISOString();
      const offlineRecord: TransactionRecord = {
        id:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `tx-${Date.now()}`,
        ...payload,
        created_at: now,
        updated_at: now,
        synced: false,
      };
      setTransactions((prev) => [offlineRecord, ...prev]);
      await saveOfflineTransaction(offlineRecord);
    }
  }

  async function handleDeleteTransaction(id: string) {
    setTransactions((prev) => prev.filter((item) => item.id !== id));
    await deleteOfflineTransaction(id);
    try {
      await deleteTransactionFromApi(id);
    } catch {
      // Already removed locally
    }
  }

  async function handleUpdatePreferences(next: AccessibilityPreferences) {
    setPreferences(next);
    await saveOfflinePreferences(next);
    try {
      await savePreferencesToApi(next);
    } catch {
      // Saved locally
    }
    announce("Accessibility and voice preferences updated.", false);
  }

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
          <div className="voice-controls" role="region" aria-label="MoneyVoice controls">
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
            type="button"
            role="tab"
            aria-selected={activeTab === "cash"}
            aria-controls="panel-cash"
            className={activeTab === "cash" ? "tab active" : "tab"}
            onClick={() => setActiveTab("cash")}
          >
            CashSense
          </button>
          <button
            id="tab-transactions"
            type="button"
            role="tab"
            aria-selected={activeTab === "transactions"}
            aria-controls="panel-transactions"
            className={activeTab === "transactions" ? "tab active" : "tab"}
            onClick={() => setActiveTab("transactions")}
          >
            TransactionSense
          </button>
          <button
            id="tab-settings"
            type="button"
            role="tab"
            aria-selected={activeTab === "settings"}
            aria-controls="panel-settings"
            className={activeTab === "settings" ? "tab active" : "tab"}
            onClick={() => setActiveTab("settings")}
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
