import {
  AccessibilityPreferences,
  CashEntry,
  ConfirmationStatus,
  ExtractedTransaction,
  InferenceResponse,
  SourceType,
  TransactionRecord,
} from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1";
const TOKEN_KEY = "nairasense_access_token";

export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token) {
    window.localStorage.setItem(TOKEN_KEY, token);
  } else {
    window.localStorage.removeItem(TOKEN_KEY);
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getStoredToken();
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(`Request failed (${response.status})`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export type AuthSession = {
  access_token: string;
  user_id: string;
  username: string;
};

export async function registerUser(username: string, password: string): Promise<AuthSession> {
  return requestJson<AuthSession>("/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export async function loginUser(username: string, password: string): Promise<AuthSession> {
  return requestJson<AuthSession>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export async function fetchCurrentUser(): Promise<{ user_id: string; username: string }> {
  return requestJson<{ user_id: string; username: string }>("/auth/me");
}

export async function inferBanknoteImage(file: File): Promise<InferenceResponse> {
  const body = new FormData();
  body.append("image", file);
  const response = await fetch(`${API_BASE}/cash/infer`, { method: "POST", body });
  if (!response.ok) {
    throw new Error(`Request failed (${response.status})`);
  }
  return (await response.json()) as InferenceResponse;
}

export async function enrollBanknoteSample(
  file: File,
  denominationNgn: number,
): Promise<{ denomination_ngn: number; sample_count: number }> {
  const body = new FormData();
  body.append("denomination_ngn", String(denominationNgn));
  body.append("image", file);
  const response = await fetch(`${API_BASE}/cash/enroll`, { method: "POST", body });
  if (!response.ok) {
    throw new Error(`Enrollment failed (${response.status})`);
  }
  return (await response.json()) as { denomination_ngn: number; sample_count: number };
}

export async function createCashSession(): Promise<{ id: string }> {
  return requestJson<{ id: string }>("/cash/sessions", {
    method: "POST",
    body: JSON.stringify({ currency: "NGN" }),
  });
}

export async function addCashEntryToApi(
  sessionId: string,
  payload: {
    predicted_denomination: number | null;
    confirmed_denomination: number | null;
    confidence: number | null;
    confirmation_status: ConfirmationStatus;
  },
): Promise<CashEntry> {
  return requestJson<CashEntry>(`/cash/sessions/${sessionId}/entries`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function deleteCashEntryFromApi(entryId: string): Promise<void> {
  return requestJson<void>(`/cash/entries/${entryId}`, { method: "DELETE" });
}

export async function extractTransactionText(
  rawText: string,
  sourceType: SourceType,
): Promise<ExtractedTransaction> {
  return requestJson<ExtractedTransaction>("/transactions/extract", {
    method: "POST",
    body: JSON.stringify({ raw_text: rawText, source_type: sourceType }),
  });
}

export async function createTransactionInApi(payload: {
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
}): Promise<TransactionRecord> {
  return requestJson<TransactionRecord>("/transactions", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listTransactionsFromApi(): Promise<TransactionRecord[]> {
  return requestJson<TransactionRecord[]>("/transactions");
}

export async function deleteTransactionFromApi(txId: string): Promise<void> {
  return requestJson<void>(`/transactions/${txId}`, { method: "DELETE" });
}

export async function fetchPreferencesFromApi(): Promise<AccessibilityPreferences> {
  return requestJson<AccessibilityPreferences>("/preferences");
}

export async function savePreferencesToApi(
  prefs: AccessibilityPreferences,
): Promise<AccessibilityPreferences> {
  return requestJson<AccessibilityPreferences>("/preferences", {
    method: "PUT",
    body: JSON.stringify(prefs),
  });
}
