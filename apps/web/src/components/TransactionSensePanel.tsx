"use client";

import { useState } from "react";
import { createWorker } from "tesseract.js";

import { extractTransactionText } from "@/lib/api";
import { SourceType, TransactionRecord } from "@/lib/types";

type TransactionSensePanelProps = {
  records: TransactionRecord[];
  onSaveRecord: (payload: {
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
  }) => Promise<void>;
  onDeleteRecord: (id: string) => Promise<void>;
  onAnnounce: (message: string, speak?: boolean) => void;
};

function formatNairaFromKobo(kobo: number | null): string {
  if (kobo === null) return "Amount not specified";
  return `₦${(kobo / 100).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function parseLocallyOffline(rawText: string, sourceType: SourceType) {
  const amtMatch = rawText.match(/(?:NGN|₦|N)\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)/i);
  const amountKobo = amtMatch ? Math.round(Number(amtMatch[1].replace(/,/g, "")) * 100) : null;
  const refMatch = rawText.match(/(?:ref(?:erence)?|txn\s*id|session\s*id)\s*[:#-]?\s*([A-Za-z0-9_-]{4,64})/i);
  const statusMatch = rawText.match(/\b(credit|debit|successful|pending|failed|reversed)\b/i);
  return {
    amount_kobo: Number.isFinite(amountKobo) ? amountKobo : null,
    sender_label: null,
    recipient_label: null,
    reference: refMatch?.[1] ?? null,
    reported_status: statusMatch ? statusMatch[1] : null,
    transaction_date: null,
    source_type: sourceType,
    disclaimer:
      "Extracted offline from text. This is not independent bank settlement verification.",
  };
}

export function TransactionSensePanel({
  records,
  onSaveRecord,
  onDeleteRecord,
  onAnnounce,
}: TransactionSensePanelProps) {
  const [rawText, setRawText] = useState("");
  const [sourceType, setSourceType] = useState<SourceType>("pasted_text");
  const [busy, setBusy] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);

  const [reviewing, setReviewing] = useState(false);
  const [amountNaira, setAmountNaira] = useState("");
  const [sender, setSender] = useState("");
  const [recipient, setRecipient] = useState("");
  const [reference, setReference] = useState("");
  const [reportedStatus, setReportedStatus] = useState("");
  const [txDate, setTxDate] = useState("");
  const [disclaimer, setDisclaimer] = useState("");

  async function runExtraction(textToParse: string, type: SourceType) {
    setBusy(true);
    try {
      let extracted;
      try {
        extracted = await extractTransactionText(textToParse, type);
      } catch {
        extracted = parseLocallyOffline(textToParse, type);
      }
      setAmountNaira(extracted.amount_kobo !== null ? (extracted.amount_kobo / 100).toFixed(2) : "");
      setSender(extracted.sender_label ?? "");
      setRecipient(extracted.recipient_label ?? "");
      setReference(extracted.reference ?? "");
      setReportedStatus(extracted.reported_status ?? "");
      setTxDate(extracted.transaction_date ?? "");
      setDisclaimer(extracted.disclaimer);
      setReviewing(true);
      const spokenAmt =
        extracted.amount_kobo !== null
          ? `${(extracted.amount_kobo / 100).toLocaleString("en-NG")} Naira`
          : "unknown amount";
      onAnnounce(
        `Extracted ${extracted.reported_status ?? "transaction"} for ${spokenAmt}. Review each field before saving.`,
        true,
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleExtract() {
    const trimmed = rawText.trim();
    if (!trimmed) {
      onAnnounce("Paste a transaction alert or receipt text first.", true);
      return;
    }
    await runExtraction(trimmed, sourceType);
  }

  async function handleReceiptOcr(file: File | null) {
    if (!file) return;
    setOcrBusy(true);
    setSourceType("receipt");
    onAnnounce("Reading receipt image with offline OCR. Please wait.", true);
    try {
      const worker = await createWorker("eng");
      const { data } = await worker.recognize(file);
      await worker.terminate();
      const text = data.text.trim();
      if (!text) {
        onAnnounce("No readable text found in the receipt image. Try a clearer photo.", true);
        return;
      }
      setRawText(text);
      await runExtraction(text, "receipt");
    } catch {
      onAnnounce("Offline OCR could not process that image. You can paste the text manually.", true);
    } finally {
      setOcrBusy(false);
    }
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    const parsedNaira = Number(amountNaira);
    const amountKobo =
      amountNaira.trim() !== "" && Number.isFinite(parsedNaira) && parsedNaira >= 0
        ? Math.round(parsedNaira * 100)
        : null;

    await onSaveRecord({
      amount_kobo: amountKobo,
      currency: "NGN",
      transaction_date: txDate.trim() || null,
      reference: reference.trim() || null,
      sender_label: sender.trim() || null,
      recipient_label: recipient.trim() || null,
      reported_status: reportedStatus.trim() || null,
      source_type: sourceType,
      extracted_fields: { reviewed_in_ui: true },
      user_confirmed: true,
    });
    setReviewing(false);
    setRawText("");
    onAnnounce("Confirmed transaction record saved.", true);
  }

  return (
    <div id="panel-transactions" role="tabpanel" aria-labelledby="tab-transactions">
      <section className="intro" aria-labelledby="tx-page-title">
        <p className="eyebrow">TRANSACTION SENSE · OFFLINE OCR</p>
        <h1 id="tx-page-title">Review receipts &amp; alerts clearly.</h1>
        <p>
          Snap a POS receipt or transfer screenshot, or paste an SMS alert to extract key fields for
          your own review and spoken summary.
        </p>
      </section>

      <section className="panel" aria-labelledby="extract-title">
        <h2 id="extract-title">1. Scan receipt image or paste text</h2>
        <p className="hint">
          Do not upload or paste PINs, OTPs, or bank passwords. Extracted status is not independent
          bank settlement verification.
        </p>

        <label className="upload">
          <span className="upload-title">
            {ocrBusy ? "Running offline OCR…" : "Scan POS receipt or transfer screenshot"}
          </span>
          <span className="hint">JPEG, PNG or WebP · processed locally in your browser</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            disabled={ocrBusy}
            onChange={(e) => void handleReceiptOcr(e.target.files?.[0] ?? null)}
          />
        </label>

        <div className="field">
          <label htmlFor="tx-source-type">Source type</label>
          <select
            id="tx-source-type"
            value={sourceType}
            onChange={(e) => setSourceType(e.target.value as SourceType)}
          >
            <option value="pasted_text">Pasted text</option>
            <option value="notification">Phone notification</option>
            <option value="receipt">Receipt text</option>
            <option value="other">Other</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="tx-raw-text">Alert or receipt text</label>
          <textarea
            id="tx-raw-text"
            rows={4}
            placeholder="Example: Credit Alert! Amt: NGN 12,500.00. From: ADAOBI OKAFOR. Ref: TXN-994812. Successful."
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
          />
        </div>

        <button type="button" className="primary" onClick={handleExtract} disabled={busy || ocrBusy}>
          {busy ? "Extracting…" : "Extract fields for review"}
        </button>
      </section>

      {reviewing && (
        <section className="panel result" aria-labelledby="tx-review-title">
          <h2 id="tx-review-title">2. Review &amp; confirm fields</h2>
          {disclaimer && <p className="prototype-warning">{disclaimer}</p>}
          <form onSubmit={handleSave} className="review-form">
            <div className="field">
              <label htmlFor="tx-amount">Amount (NGN)</label>
              <input
                id="tx-amount"
                type="number"
                step="0.01"
                min="0"
                value={amountNaira}
                onChange={(e) => setAmountNaira(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="tx-status">Reported status</label>
              <input
                id="tx-status"
                type="text"
                value={reportedStatus}
                onChange={(e) => setReportedStatus(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="tx-sender">Sender</label>
              <input
                id="tx-sender"
                type="text"
                value={sender}
                onChange={(e) => setSender(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="tx-recipient">Recipient</label>
              <input
                id="tx-recipient"
                type="text"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="tx-reference">Reference</label>
              <input
                id="tx-reference"
                type="text"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="tx-date">Date / time</label>
              <input
                id="tx-date"
                type="text"
                value={txDate}
                onChange={(e) => setTxDate(e.target.value)}
              />
            </div>

            <div className="actions">
              <button type="submit" className="primary">
                Confirm &amp; save record
              </button>
              <button type="button" className="secondary" onClick={() => setReviewing(false)}>
                Discard draft
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="panel" aria-labelledby="tx-list-title">
        <h2 id="tx-list-title">Saved transaction records ({records.length})</h2>
        {records.length === 0 ? (
          <p className="hint">No confirmed transaction records yet.</p>
        ) : (
          <ul className="entry-list" aria-label="Saved transaction records">
            {records.map((rec) => (
              <li key={rec.id} className="tx-item">
                <div>
                  <p className="tx-amount">{formatNairaFromKobo(rec.amount_kobo)}</p>
                  <p className="hint">
                    {rec.reported_status ? `${rec.reported_status} · ` : ""}
                    {rec.sender_label ? `From ${rec.sender_label} · ` : ""}
                    {rec.recipient_label ? `To ${rec.recipient_label} · ` : ""}
                    {rec.reference ? `Ref ${rec.reference}` : rec.source_type}
                  </p>
                </div>
                <div className="actions">
                  <button
                    type="button"
                    className="secondary small-btn"
                    onClick={() =>
                      onAnnounce(
                        `${rec.reported_status ?? "Transaction"} of ${formatNairaFromKobo(rec.amount_kobo)}. ${rec.sender_label ? `From ${rec.sender_label}.` : ""} ${rec.reference ? `Reference ${rec.reference}.` : ""}`,
                        true,
                      )
                    }
                  >
                    Speak
                  </button>
                  <button
                    type="button"
                    className="secondary small-btn"
                    onClick={async () => {
                      await onDeleteRecord(rec.id);
                      onAnnounce("Transaction record deleted.", true);
                    }}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
