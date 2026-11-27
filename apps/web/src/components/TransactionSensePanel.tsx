"use client";

import { useState } from "react";
import { createWorker } from "tesseract.js";

import { extractTransactionText } from "@/lib/api";
import { parseLocallyOffline } from "@/lib/offlineParser";
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
  const [labeledAmounts, setLabeledAmounts] = useState<Array<{ amount_ngn: string; context: string }>>(
    [],
  );
  const [amountRequiresConfirmation, setAmountRequiresConfirmation] = useState(false);
  const [dateConfirmed, setDateConfirmed] = useState(true);
  const [rawExtractedFields, setRawExtractedFields] = useState<Record<string, unknown>>({});
  const [suggestedAmountKobo, setSuggestedAmountKobo] = useState<number | null>(null);
  const [sender, setSender] = useState("");
  const [recipient, setRecipient] = useState("");
  const [reference, setReference] = useState("");
  const [transactionDirection, setTransactionDirection] = useState("");
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
      const fields = (extracted.extracted_fields ?? {}) as Record<string, unknown>;
      const rawLabeled = Array.isArray(fields.labeled_amounts)
        ? (fields.labeled_amounts as Array<{ amount_ngn?: unknown; context?: unknown }>)
            .filter((item) => item && typeof item.amount_ngn === "string")
            .map((item) => ({
              amount_ngn: String(item.amount_ngn),
              context: typeof item.context === "string" ? item.context : "Other",
            }))
        : Array.isArray(fields.candidate_amounts_ngn)
          ? fields.candidate_amounts_ngn.map((c) => ({ amount_ngn: String(c), context: "Other" }))
          : [];
      const requireAmtConfirm =
        Boolean(fields.amount_requires_confirmation) ||
        Boolean(fields.multiple_amounts_detected) ||
        rawLabeled.length > 1;
      const ambDate = Boolean(fields.ambiguous_date_detected);

      setLabeledAmounts(rawLabeled);
      setAmountRequiresConfirmation(requireAmtConfirm);
      setDateConfirmed(!ambDate);
      setRawExtractedFields(fields);
      setSuggestedAmountKobo(extracted.amount_kobo);

      // Do NOT silently pre-fill when multiple amounts or non-Amount contexts (Fee/Balance) are detected
      setAmountNaira(
        !requireAmtConfirm && extracted.amount_kobo !== null
          ? (extracted.amount_kobo / 100).toFixed(2)
          : "",
      );
      setSender(extracted.sender_label ?? "");
      setRecipient(extracted.recipient_label ?? "");
      setReference(extracted.reference ?? "");
      setTransactionDirection(
        typeof fields.transaction_direction === "string" ? fields.transaction_direction : "",
      );
      setReportedStatus(extracted.reported_status ?? "");
      setTxDate(extracted.transaction_date ?? "");
      setDisclaimer(extracted.disclaimer);
      setReviewing(true);
      const spokenAmt = requireAmtConfirm
        ? "please review and select the transaction amount"
        : extracted.amount_kobo !== null
          ? `${(extracted.amount_kobo / 100).toLocaleString("en-NG")} Naira`
          : "unknown amount";
      onAnnounce(
        `Extracted ${extracted.reported_status ?? "transaction"}: ${spokenAmt}. Review each field before saving.`,
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
    let worker: Awaited<ReturnType<typeof createWorker>> | null = null;
    try {
      worker = await createWorker("eng");
      const { data } = await worker.recognize(file);
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
      if (worker) {
        await worker.terminate().catch(() => {});
      }
      setOcrBusy(false);
    }
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    if (!dateConfirmed) {
      onAnnounce("Please confirm the ambiguous date or leave it unknown before saving.", true);
      return;
    }
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
      extracted_fields: {
        ...rawExtractedFields,
        transaction_direction: transactionDirection.trim() || null,
        date_confirmed_by_user: dateConfirmed,
        reviewed_in_ui: true,
        suggested_amount_kobo: suggestedAmountKobo,
        confirmed_amount_kobo: amountKobo,
        user_selected_amount: amountKobo !== null,
      },
      user_confirmed: true,
    });
    setReviewing(false);
    setRawText("");
    onAnnounce("Confirmed transaction record saved.", true);
  }

  return (
    <div id="panel-transactions" role="tabpanel" aria-labelledby="tab-transactions">
      <section className="intro" aria-labelledby="tx-page-title">
        <p className="eyebrow">TRANSACTION SENSE · OCR-ASSISTED EXTRACTION</p>
        <h1 id="tx-page-title">Review receipts &amp; alerts clearly.</h1>
        <p>
          OCR-assisted transaction information extraction with user confirmation. Snap a POS
          receipt or transfer screenshot, or paste an SMS alert to extract candidate fields for your
          review.
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
          {Boolean(rawExtractedFields.ambiguous_status_detected) && (
            <p className="prototype-warning" role="alert">
              Conflicting outcome words were detected in this message. Please verify the reported
              outcome before saving.
            </p>
          )}
          {Boolean(rawExtractedFields.ambiguous_date_detected) && !dateConfirmed && (
            <div className="prototype-warning" role="alert">
              <p>
                The extracted date format (day/month vs month/day) may be ambiguous. Confirm the
                date interpretation or leave it unknown before saving:
              </p>
              <div className="actions">
                <button
                  type="button"
                  className="secondary small-btn"
                  onClick={() => {
                    setDateConfirmed(true);
                    onAnnounce(`Confirmed date as ${txDate} (day-first).`, true);
                  }}
                >
                  Confirm {txDate} (day-first)
                </button>
                <button
                  type="button"
                  className="secondary small-btn"
                  onClick={() => {
                    const m = txDate.match(/^(\d{2})([/-])(\d{2})([/-]\d{4})$/);
                    const swapped = m ? `${m[3]}${m[2]}${m[1]}${m[4]}` : txDate;
                    setTxDate(swapped);
                    setDateConfirmed(true);
                    onAnnounce(`Swapped date to ${swapped}.`, true);
                  }}
                >
                  Swap day/month
                </button>
                <button
                  type="button"
                  className="secondary small-btn"
                  onClick={() => {
                    setTxDate("");
                    setDateConfirmed(true);
                    onAnnounce("Date left unknown.", true);
                  }}
                >
                  Leave date unknown
                </button>
              </div>
            </div>
          )}
          <form onSubmit={handleSave} className="review-form">
            {amountRequiresConfirmation && labeledAmounts.length > 0 && (
              <div className="prototype-warning" role="group" aria-label="Choose transaction amount">
                <p>
                  Confirm which detected value is the transaction amount, enter it manually, or
                  leave it blank:
                </p>
                <div className="actions">
                  {labeledAmounts.map((item, idx) => (
                    <button
                      key={`${item.amount_ngn}-${item.context}-${idx}`}
                      type="button"
                      aria-pressed={amountNaira === item.amount_ngn}
                      className={
                        amountNaira === item.amount_ngn ? "primary small-btn" : "secondary small-btn"
                      }
                      onClick={() => {
                        setAmountNaira(item.amount_ngn);
                        onAnnounce(
                          `Selected ${Number(item.amount_ngn).toLocaleString("en-NG", { minimumFractionDigits: 2 })} Naira (${item.context}).`,
                          true,
                        );
                      }}
                    >
                      ₦{Number(item.amount_ngn).toLocaleString("en-NG", { minimumFractionDigits: 2 })}{" "}
                      ({item.context})
                    </button>
                  ))}
                  <button
                    type="button"
                    aria-pressed={amountNaira === ""}
                    className={amountNaira === "" ? "primary small-btn" : "secondary small-btn"}
                    onClick={() => {
                      setAmountNaira("");
                      onAnnounce("Amount left unknown.", true);
                    }}
                  >
                    Leave unknown
                  </button>
                </div>
              </div>
            )}
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
              <label htmlFor="tx-direction">Transaction direction</label>
              <select
                id="tx-direction"
                value={transactionDirection}
                onChange={(e) => setTransactionDirection(e.target.value)}
              >
                <option value="">Unknown / Not specified</option>
                <option value="Debit">Debit</option>
                <option value="Credit">Credit</option>
                <option value="Ambiguous">Ambiguous</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="tx-status">Reported outcome</label>
              <select
                id="tx-status"
                value={reportedStatus}
                onChange={(e) => setReportedStatus(e.target.value)}
              >
                <option value="">Unknown / Needs review</option>
                <option value="Successful">Successful</option>
                <option value="Pending">Pending</option>
                <option value="Failed">Failed</option>
                <option value="Reversed">Reversed</option>
                <option value="Ambiguous (Review Required)">Ambiguous (Review Required)</option>
              </select>
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
              <button type="submit" className="primary" disabled={!dateConfirmed}>
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
                    {typeof rec.extracted_fields?.transaction_direction === "string"
                      ? `${rec.extracted_fields.transaction_direction} · `
                      : ""}
                    {rec.reported_status ? `${rec.reported_status} · ` : ""}
                    {rec.user_confirmed ? "Confirmed by user · " : "Needs review · "}
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
