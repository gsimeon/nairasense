"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { LiveCameraScanner } from "@/components/LiveCameraScanner";
import { enrollBanknoteSample, inferBanknoteImage } from "@/lib/api";
import { playCue } from "@/lib/audioCues";
import { calculateNairaChange, formatChangeSpeech } from "@/lib/changeCalculator";
import { formatAddedSpeech, formatDetectedNoteSpeech, formatTotalSpeech } from "@/lib/i18n";
import {
  CashEntry,
  ConfirmationStatus,
  InferenceResponse,
  NAIRA_DENOMINATIONS,
  VoiceLanguage,
} from "@/lib/types";
import {
  isVoiceRecognitionSupported,
  startVoiceListener,
  VoiceCommand,
} from "@/lib/voiceCommands";

type CashSensePanelProps = {
  entries: CashEntry[];
  voiceLanguage: VoiceLanguage;
  cuesEnabled: boolean;
  onAddEntry: (input: {
    predicted_denomination: number | null;
    confirmed_denomination: number | null;
    confidence: number | null;
    confirmation_status: ConfirmationStatus;
  }) => Promise<void>;
  onDeleteEntry: (entryId: string) => Promise<void>;
  onClearSession: () => Promise<void>;
  onAnnounce: (message: string, speak?: boolean) => void;
  onRepeatVoice: () => void;
  onStopVoice: () => void;
};

export function CashSensePanel({
  entries,
  voiceLanguage,
  cuesEnabled,
  onAddEntry,
  onDeleteEntry,
  onClearSession,
  onAnnounce,
  onRepeatVoice,
  onStopVoice,
}: CashSensePanelProps) {
  const [file, setFile] = useState<File | null>(null);
  const [lastScannedFile, setLastScannedFile] = useState<File | null>(null);
  const [result, setResult] = useState<InferenceResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [showCorrector, setShowCorrector] = useState(false);

  const [priceInput, setPriceInput] = useState("");
  const [voiceListening, setVoiceListening] = useState(false);
  const [lastHeard, setLastHeard] = useState<string | null>(null);
  const stopVoiceRef = useRef<(() => void) | null>(null);

  const confirmedEntries = useMemo(
    () =>
      entries.filter(
        (entry) =>
          (entry.confirmation_status === "confirmed" || entry.confirmation_status === "corrected") &&
          entry.confirmed_denomination !== null,
      ),
    [entries],
  );

  const totalNgn = useMemo(
    () => confirmedEntries.reduce((sum, entry) => sum + (entry.confirmed_denomination ?? 0), 0),
    [confirmedEntries],
  );

  const parsedPrice = Number(priceInput);
  const hasPrice = priceInput.trim() !== "" && Number.isFinite(parsedPrice) && parsedPrice > 0;
  const changeBreakdown = useMemo(
    () => (hasPrice ? calculateNairaChange(totalNgn, parsedPrice) : null),
    [hasPrice, parsedPrice, totalNgn],
  );

  const classifyFile = useCallback(
    async (targetFile: File, announceStart: boolean) => {
      setBusy(true);
      setResult(null);
      setShowCorrector(false);
      playCue("capture", cuesEnabled);
      if (announceStart) {
        onAnnounce("Analyzing note image. Please wait.", true);
      }
      try {
        setLastScannedFile(targetFile);
        const data = await inferBanknoteImage(targetFile);
        setResult(data);
        if (data.image_quality.accepted) {
          playCue("detected", cuesEnabled);
          const msg = formatDetectedNoteSpeech(
            voiceLanguage,
            data.prediction.denomination_ngn,
            Math.round(data.prediction.confidence * 100),
          );
          onAnnounce(msg, true);
        } else {
          playCue("warning", cuesEnabled);
          onAnnounce(
            `Could not identify note (${data.image_quality.warnings.join(", ") || "low quality"}). Please adjust lighting or hold steady.`,
            true,
          );
        }
      } catch (error) {
        playCue("error", cuesEnabled);
        onAnnounce(error instanceof Error ? error.message : "Unable to reach the API.", true);
      } finally {
        setBusy(false);
      }
    },
    [cuesEnabled, onAnnounce, voiceLanguage],
  );

  async function classify() {
    if (!file) {
      playCue("warning", cuesEnabled);
      onAnnounce("Choose a photo of one Naira note first.", true);
      return;
    }
    await classifyFile(file, true);
  }

  const handleConfirm = useCallback(
    async (value: number, status: "confirmed" | "corrected") => {
      await onAddEntry({
        predicted_denomination: result?.prediction.denomination_ngn ?? null,
        confirmed_denomination: value,
        confidence: result?.prediction.confidence ?? null,
        confirmation_status: status,
      });
      if (lastScannedFile && result) {
        enrollBanknoteSample(lastScannedFile, value).catch(() => {});
      }
      setResult(null);
      setFile(null);
      setLastScannedFile(null);
      setShowCorrector(false);
      playCue("confirm", cuesEnabled);
      const nextTotal = totalNgn + value;
      onAnnounce(formatAddedSpeech(voiceLanguage, value, nextTotal), true);
    },
    [cuesEnabled, lastScannedFile, onAddEntry, onAnnounce, result, totalNgn, voiceLanguage],
  );

  const handleReject = useCallback(async () => {
    if (result) {
      await onAddEntry({
        predicted_denomination: result.prediction.denomination_ngn,
        confirmed_denomination: null,
        confidence: result.prediction.confidence,
        confirmation_status: "rejected",
      });
    }
    setResult(null);
    setLastScannedFile(null);
    setShowCorrector(false);
    playCue("warning", cuesEnabled);
    onAnnounce("Suggestion rejected. It was not added to your total.", true);
  }, [cuesEnabled, onAddEntry, onAnnounce, result]);

  const handleVoiceCommand = useCallback(
    (cmd: VoiceCommand) => {
      if (cmd.type === "confirm" && result && result.image_quality.accepted) {
        setLastHeard("Confirm");
        void handleConfirm(result.prediction.denomination_ngn, "confirmed");
      } else if (cmd.type === "correct" && result && result.image_quality.accepted) {
        setLastHeard(`Change to ₦${cmd.denomination}`);
        void handleConfirm(cmd.denomination, "corrected");
      } else if (cmd.type === "reject" && result) {
        setLastHeard("Reject");
        void handleReject();
      } else if (cmd.type === "total") {
        setLastHeard("Total");
        onAnnounce(formatTotalSpeech(voiceLanguage, totalNgn, confirmedEntries.length), true);
      } else if (cmd.type === "repeat") {
        setLastHeard("Repeat");
        onRepeatVoice();
      } else if (cmd.type === "stop") {
        setLastHeard("Stop");
        onStopVoice();
      } else if (cmd.type === "unknown") {
        setLastHeard(`"${cmd.transcript}"`);
      }
    },
    [
      confirmedEntries.length,
      handleConfirm,
      handleReject,
      onAnnounce,
      onRepeatVoice,
      onStopVoice,
      result,
      totalNgn,
      voiceLanguage,
    ],
  );

  useEffect(() => {
    return () => {
      stopVoiceRef.current?.();
    };
  }, []);

  function toggleVoiceCommands() {
    if (voiceListening) {
      stopVoiceRef.current?.();
      stopVoiceRef.current = null;
      setVoiceListening(false);
      onAnnounce("Voice commands turned off.", false);
      return;
    }
    if (!isVoiceRecognitionSupported()) {
      onAnnounce("Voice commands are not supported in this browser. Use the buttons below.", true);
      return;
    }
    stopVoiceRef.current = startVoiceListener(handleVoiceCommand, setVoiceListening);
    onAnnounce(
      "Voice commands active. Say Confirm, Reject, Change to 500, Total, Repeat, or Stop.",
      true,
    );
  }

  return (
    <div id="panel-cash" role="tabpanel" aria-labelledby="tab-cash">
      <section className="intro" aria-labelledby="cash-page-title">
        <p className="eyebrow">CASH SENSE · 100% OFFLINE</p>
        <h1 id="cash-page-title">Count Naira with more confidence.</h1>
        <p>
          Scan notes live with your camera or record denominations directly. Only entries you
          confirm or correct change your total.
        </p>
        <div className="actions">
          <button
            type="button"
            className={voiceListening ? "primary" : "secondary"}
            aria-pressed={voiceListening}
            onClick={toggleVoiceCommands}
          >
            {voiceListening ? "Voice commands: ON (tap to stop)" : "Enable hands-free voice commands"}
          </button>
          {lastHeard && <span className="hint">Last voice command: {lastHeard}</span>}
        </div>
      </section>

      <section className="panel" aria-labelledby="capture-title">
        <h2 id="capture-title">1. Scan live or upload a note photo</h2>
        <p className="hint">
          Place one note on a plain surface. Keep the full note inside the camera frame and use good
          lighting.
        </p>

        <LiveCameraScanner
          busy={busy}
          paused={Boolean(result && result.image_quality.accepted)}
          onCapture={(capturedFile) => classifyFile(capturedFile, false)}
          onAnnounce={onAnnounce}
        />

        <label className="upload">
          <span className="upload-title">Or choose / take a photo</span>
          <span className="hint">JPEG, PNG or WebP · one note per image</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            onChange={(event) => {
              const selected = event.target.files?.[0] ?? null;
              setFile(selected);
              setResult(null);
              setShowCorrector(false);
              if (selected) {
                onAnnounce(`Selected image ${selected.name}.`, false);
              }
            }}
          />
        </label>
        {file && (
          <p className="selected" aria-live="polite">
            Selected: {file.name}
          </p>
        )}
        <button className="primary" type="button" onClick={classify} disabled={!file || busy}>
          {busy ? "Processing…" : "Identify uploaded photo"}
        </button>
      </section>

      {result && result.image_quality.accepted && (
        <section className="panel result" aria-labelledby="result-title">
          <h2 id="result-title">2. Review the suggestion</h2>
          <p className="amount">₦{result.prediction.denomination_ngn.toLocaleString("en-NG")}</p>
          <p>
            Confidence score: {(result.prediction.confidence * 100).toFixed(0)}% (
            {result.decision.confidence_band})
          </p>
          {result.model.version === "0.0.0-mock" ? (
            <p className="prototype-warning">
              Mock mode active. Switch VISION_PROVIDER to local for offline recognition.
            </p>
          ) : (
            <p className="hint">
              Identified offline by {result.model.name}. Confirming or correcting teaches your local
              model.
            </p>
          )}
          <div className="actions">
            <button
              type="button"
              className="primary"
              onClick={() => handleConfirm(result.prediction.denomination_ngn, "confirmed")}
            >
              Confirm ₦{result.prediction.denomination_ngn.toLocaleString("en-NG")}
            </button>
            <button
              type="button"
              className="secondary"
              aria-expanded={showCorrector}
              onClick={() => setShowCorrector((prev) => !prev)}
            >
              {showCorrector ? "Hide denomination picker" : "Correct value"}
            </button>
            <button type="button" className="secondary" onClick={handleReject}>
              Reject suggestion
            </button>
          </div>

          {showCorrector && (
            <div
              className="denomination-picker"
              role="group"
              aria-label="Select correct Naira denomination"
            >
              <p className="hint">Choose the actual note denomination:</p>
              <div className="denomination-grid">
                {NAIRA_DENOMINATIONS.map((denom) => (
                  <button
                    key={denom}
                    type="button"
                    className="secondary denom-btn"
                    onClick={() => handleConfirm(denom, "corrected")}
                  >
                    ₦{denom.toLocaleString("en-NG")}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      <section className="panel" aria-labelledby="manual-add-title">
        <h2 id="manual-add-title">Quick manual entry</h2>
        <p className="hint">Add a confirmed Naira note directly without uploading a photo.</p>
        <div className="denomination-grid" role="group" aria-label="Quick add Naira denomination">
          {NAIRA_DENOMINATIONS.map((denom) => (
            <button
              key={denom}
              type="button"
              className="secondary denom-btn"
              onClick={() => handleConfirm(denom, "confirmed")}
            >
              + ₦{denom.toLocaleString("en-NG")}
            </button>
          ))}
        </div>
      </section>

      <section className="total" aria-labelledby="total-title">
        <div className="total-header">
          <div>
            <p className="eyebrow">USER-CONFIRMED ENTRIES</p>
            <h2 id="total-title">Current cash total</h2>
          </div>
          <button
            type="button"
            className="secondary"
            onClick={() =>
              onAnnounce(formatTotalSpeech(voiceLanguage, totalNgn, confirmedEntries.length), true)
            }
          >
            Speak total
          </button>
        </div>
        <p className="total-amount">₦{totalNgn.toLocaleString("en-NG")}</p>
        <p className="hint">
          {confirmedEntries.length} confirmed {confirmedEntries.length === 1 ? "entry" : "entries"}
        </p>

        <div className="change-box">
          <div className="field">
            <label htmlFor="target-price-input">Change helper — item / bill amount (₦)</label>
            <input
              id="target-price-input"
              type="number"
              min="0"
              step="5"
              placeholder="Optional: e.g. 1350"
              value={priceInput}
              onChange={(e) => setPriceInput(e.target.value)}
            />
          </div>
          {changeBreakdown && (
            <div className="change-result" aria-live="polite">
              <p>
                <strong>{formatChangeSpeech(changeBreakdown)}</strong>
              </p>
              <button
                type="button"
                className="secondary small-btn"
                onClick={() => onAnnounce(formatChangeSpeech(changeBreakdown), true)}
              >
                Speak change
              </button>
            </div>
          )}
        </div>

        {confirmedEntries.length > 0 && (
          <>
            <ul className="entry-list" aria-label="Confirmed cash entries">
              {confirmedEntries.map((entry, idx) => (
                <li key={entry.id} className="entry-item">
                  <span>
                    <strong>Note {idx + 1}:</strong> ₦
                    {(entry.confirmed_denomination ?? 0).toLocaleString("en-NG")}{" "}
                    <span className="hint">({entry.confirmation_status})</span>
                  </span>
                  <button
                    type="button"
                    className="secondary small-btn"
                    aria-label={`Remove Note ${idx + 1}, ${entry.confirmed_denomination} Naira`}
                    onClick={async () => {
                      await onDeleteEntry(entry.id);
                      onAnnounce(
                        `Removed ${entry.confirmed_denomination?.toLocaleString("en-NG")} Naira entry.`,
                        true,
                      );
                    }}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="secondary"
              onClick={async () => {
                await onClearSession();
                onAnnounce("Cash session cleared. Total is now 0 Naira.", true);
              }}
            >
              Clear cash session
            </button>
          </>
        )}
      </section>
    </div>
  );
}
