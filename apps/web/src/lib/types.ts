export const NAIRA_DENOMINATIONS = [5, 10, 20, 50, 100, 200, 500, 1000] as const;
export type NairaDenomination = (typeof NAIRA_DENOMINATIONS)[number];

export type TextSize = "standard" | "large" | "extra_large";
export type VoiceLanguage = "en-NG" | "pcm" | "yo" | "ha" | "ig";

export type AccessibilityPreferences = {
  text_size: TextSize;
  high_contrast: boolean;
  speech_enabled: boolean;
  speech_rate: number;
  voice_language?: VoiceLanguage;
  cues_enabled?: boolean;
};

export const DEFAULT_PREFERENCES: AccessibilityPreferences = {
  text_size: "large",
  high_contrast: false,
  speech_enabled: true,
  speech_rate: 1.0,
  voice_language: "en-NG",
  cues_enabled: true,
};

export type InferenceResponse = {
  inference_id: string;
  prediction: { denomination_ngn: number; confidence: number };
  image_quality: { accepted: boolean; warnings: string[] };
  decision: { requires_user_confirmation: boolean; confidence_band: string };
  model: { name: string; version: string };
};

export type ConfirmationStatus = "pending" | "confirmed" | "corrected" | "rejected";

export type CashEntry = {
  id: string;
  session_id: string;
  predicted_denomination: number | null;
  confirmed_denomination: number | null;
  confidence: number | null;
  confirmation_status: ConfirmationStatus;
  created_at: string;
  synced?: boolean;
};

export type SourceType = "notification" | "receipt" | "pasted_text" | "other";

export type ExtractedTransaction = {
  amount_kobo: number | null;
  currency: string;
  transaction_date: string | null;
  reference: string | null;
  sender_label: string | null;
  recipient_label: string | null;
  reported_status: string | null;
  source_type: SourceType;
  extracted_fields: Record<string, unknown>;
  requires_user_confirmation: boolean;
  disclaimer: string;
};

export type TransactionRecord = {
  id: string;
  amount_kobo: number | null;
  currency: string;
  transaction_date: string | null;
  reference: string | null;
  sender_label: string | null;
  recipient_label: string | null;
  reported_status: string | null;
  source_type: SourceType;
  extracted_fields: Record<string, unknown>;
  user_confirmed: boolean;
  created_at: string;
  updated_at: string;
  synced?: boolean;
};
