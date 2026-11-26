"use client";

import { LANGUAGE_LABELS } from "@/lib/i18n";
import { AccessibilityPreferences, TextSize, VoiceLanguage } from "@/lib/types";

type PreferencesPanelProps = {
  preferences: AccessibilityPreferences;
  onChange: (next: AccessibilityPreferences) => Promise<void>;
  onTestVoice: () => void;
};

export function PreferencesPanel({ preferences, onChange, onTestVoice }: PreferencesPanelProps) {
  const voiceLang = preferences.voice_language ?? "en-NG";
  const cuesEnabled = preferences.cues_enabled ?? true;

  return (
    <div id="panel-settings" role="tabpanel" aria-labelledby="tab-settings">
      <section className="intro" aria-labelledby="prefs-page-title">
        <p className="eyebrow">ACCESSIBILITY &amp; MONEYVOICE</p>
        <h1 id="prefs-page-title">Customize display and voice output.</h1>
        <p>Your preferences are saved locally on this device and synced when connected.</p>
      </section>

      <section className="panel" aria-labelledby="display-prefs-title">
        <h2 id="display-prefs-title">Visual readability</h2>
        <div className="field">
          <span className="field-label" id="text-size-label">
            Text size
          </span>
          <div className="actions" role="group" aria-labelledby="text-size-label">
            {(
              [
                ["standard", "Standard (16px)"],
                ["large", "Large (18px)"],
                ["extra_large", "Extra Large (22px)"],
              ] as [TextSize, string][]
            ).map(([size, label]) => (
              <button
                key={size}
                type="button"
                className={preferences.text_size === size ? "primary" : "secondary"}
                aria-pressed={preferences.text_size === size}
                onClick={() => onChange({ ...preferences, text_size: size })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={preferences.high_contrast}
              onChange={(e) => onChange({ ...preferences, high_contrast: e.target.checked })}
            />
            <span>Enable high-contrast mode</span>
          </label>
        </div>
      </section>

      <section className="panel" aria-labelledby="voice-prefs-title">
        <h2 id="voice-prefs-title">MoneyVoice &amp; audio cues</h2>
        <div className="field">
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={preferences.speech_enabled}
              onChange={(e) => onChange({ ...preferences, speech_enabled: e.target.checked })}
            />
            <span>Automatically speak important results and totals</span>
          </label>
        </div>

        <div className="field">
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={cuesEnabled}
              onChange={(e) => onChange({ ...preferences, cues_enabled: e.target.checked })}
            />
            <span>Play audio chimes and haptic vibration cues</span>
          </label>
        </div>

        <div className="field">
          <label htmlFor="voice-lang-select">Spoken language</label>
          <select
            id="voice-lang-select"
            value={voiceLang}
            onChange={(e) =>
              onChange({ ...preferences, voice_language: e.target.value as VoiceLanguage })
            }
          >
            {(Object.entries(LANGUAGE_LABELS) as [VoiceLanguage, string][]).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="speech-rate-select">Speech speed: {preferences.speech_rate.toFixed(2)}x</label>
          <select
            id="speech-rate-select"
            value={preferences.speech_rate}
            onChange={(e) => onChange({ ...preferences, speech_rate: Number(e.target.value) })}
          >
            <option value={0.75}>0.75x (Slower)</option>
            <option value={1.0}>1.00x (Normal)</option>
            <option value={1.25}>1.25x (Faster)</option>
            <option value={1.5}>1.50x (Fast)</option>
            <option value={1.75}>1.75x (Very fast)</option>
          </select>
        </div>

        <button type="button" className="primary" onClick={onTestVoice}>
          Test MoneyVoice output
        </button>
      </section>
    </div>
  );
}
