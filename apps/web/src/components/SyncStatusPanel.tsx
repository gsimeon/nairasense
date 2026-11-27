"use client";

import { PendingSyncItem } from "@/lib/storage";

type SyncStatusPanelProps = {
  isAuthenticated: boolean;
  isOnline: boolean;
  pendingCount: number;
  failedItems: PendingSyncItem[];
  lastSyncedAt: string | null;
  onRetryFailed: () => Promise<void>;
  onAnnounce: (message: string, speak?: boolean) => void;
};

export function SyncStatusPanel({
  isAuthenticated,
  isOnline,
  pendingCount,
  failedItems,
  lastSyncedAt,
  onRetryFailed,
  onAnnounce,
}: SyncStatusPanelProps) {
  const statusSummary = !isAuthenticated
    ? "Local-only mode. Sign in to sync records across devices."
    : failedItems.length > 0
      ? `${failedItems.length} record(s) failed to sync and need retry.`
      : pendingCount > 0
        ? `${pendingCount} record(s) saved locally and waiting to sync.`
        : "All confirmed records are synced.";

  return (
    <section className="panel" aria-labelledby="sync-status-title">
      <div className="total-header">
        <div>
          <h2 id="sync-status-title">Sync &amp; offline status</h2>
          <p className="hint" aria-live="polite">
            {statusSummary}
          </p>
        </div>
        <button
          type="button"
          className="secondary small-btn"
          onClick={() => onAnnounce(statusSummary, true)}
        >
          Speak sync status
        </button>
      </div>

      <dl className="sync-grid">
        <div>
          <dt className="hint">Connection</dt>
          <dd>
            <strong>{isOnline ? "Online" : "Offline"}</strong>
          </dd>
        </div>
        <div>
          <dt className="hint">Pending records</dt>
          <dd>
            <strong>{pendingCount}</strong>
          </dd>
        </div>
        <div>
          <dt className="hint">Failed records</dt>
          <dd>
            <strong>{failedItems.length}</strong>
          </dd>
        </div>
        <div>
          <dt className="hint">Last successful sync</dt>
          <dd>
            <strong>
              {lastSyncedAt ? new Date(lastSyncedAt).toLocaleTimeString() : "Not yet synced"}
            </strong>
          </dd>
        </div>
      </dl>

      {isAuthenticated && failedItems.length > 0 && (
        <div className="prototype-warning" role="alert">
          <p>
            {failedItems.length} record(s) could not be synced after multiple attempts. Your record
            remains saved in this browser&apos;s local storage and is waiting to sync. Keep this
            device available until synchronisation succeeds.
          </p>
          <ul className="entry-list" aria-label="Failed sync records">
            {failedItems.map((item) => {
              const label =
                item.kind === "cash_entry"
                  ? "Cash entry"
                  : item.kind === "transaction"
                    ? "Transaction record"
                    : item.kind === "delete_cash_entry"
                      ? "Remove cash entry"
                      : item.kind === "delete_transaction"
                        ? "Remove transaction"
                        : "Clear cash session";
              return (
                <li key={item.id} className="entry-item">
                  <span>
                    <strong>{label}</strong> · queued{" "}
                    {new Date(item.created_at).toLocaleTimeString()}
                  </span>
                  <span className="hint">Saved locally; waiting for retry</span>
                </li>
              );
            })}
          </ul>
          <button type="button" className="primary small-btn" onClick={() => void onRetryFailed()}>
            Retry failed records
          </button>
        </div>
      )}
    </section>
  );
}
