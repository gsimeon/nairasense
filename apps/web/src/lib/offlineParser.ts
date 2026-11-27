export type SourceType = "receipt" | "notification" | "pasted_text" | "other";

export interface OfflineExtractedTransaction {
  amount_kobo: number | null;
  sender_label: string | null;
  recipient_label: string | null;
  reference: string | null;
  reported_status: string | null;
  transaction_date: string | null;
  source_type: SourceType;
  extracted_fields: {
    parser: string;
    multiple_amounts_detected: boolean;
    candidate_amounts_ngn: string[];
    transaction_direction: string | null;
    ambiguous_status_detected: boolean;
    candidate_statuses: string[];
  };
  disclaimer: string;
}

export function parseNairaStringToKobo(raw: string): number | null {
  const cleaned = raw.replace(/,/g, "").trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  const kobo = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return Number.isSafeInteger(kobo) ? kobo : null;
}

const OFFLINE_DIRECTION_RULES: Array<[RegExp, string]> = [
  [/\bcredit\b/i, "Credit"],
  [/\bcredited\b/i, "Credit"],
  [/\bdebit\b/i, "Debit"],
  [/\bdebited\b/i, "Debit"],
];

const OFFLINE_OUTCOME_RULES: Array<[RegExp, string]> = [
  [/\breversed\b/i, "Reversed"],
  [/\breversal\b/i, "Reversed"],
  [/\bfailed\b/i, "Failed"],
  [/\bdeclined\b/i, "Failed"],
  [/\bpending\b/i, "Pending"],
  [/\bsuccessful\b/i, "Successful"],
  [/\bsuccess\b/i, "Successful"],
  [/\bapproved\b/i, "Successful"],
  [/\bcompleted\b/i, "Successful"],
];

const FROM_PATTERN =
  /(?:from|sender)\s*[:-]?\s*(.+?)(?=\s*(?:\.\s+|\r|\n|\||;|\b(?:to|recipient|beneficiary|ref|reference|date|amt|amount|status)\s*:|$))/i;
const TO_PATTERN =
  /(?:to|recipient|beneficiary)\s*[:-]?\s*(.+?)(?=\s*(?:\.\s+|\r|\n|\||;|\b(?:from|sender|ref|reference|date|amt|amount|status)\s*:|$))/i;
const DATE_PATTERN =
  /(\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?|\d{2}\/\d{2}\/\d{4}|\d{2}-\d{2}-\d{4})/;

function cleanLabel(raw: string | undefined): string | null {
  if (!raw) return null;
  const first = raw.split(/[\r\n|;]+/)[0] ?? "";
  const cleaned = first.replace(/^[\s.,:-]+|[\s.,:-]+$/g, "");
  return cleaned || null;
}

function validateDateToken(token: string | undefined): string | null {
  if (!token) return null;
  const datePart = token.split(/[T ]/)[0] ?? "";
  let year: number;
  let month: number;
  let day: number;
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    [year, month, day] = datePart.split("-").map(Number);
  } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(datePart)) {
    [day, month, year] = datePart.split("/").map(Number);
  } else if (/^\d{2}-\d{2}-\d{4}$/.test(datePart)) {
    [day, month, year] = datePart.split("-").map(Number);
  } else {
    return null;
  }
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return token;
}

export function parseLocallyOffline(
  rawText: string,
  sourceType: SourceType,
): OfflineExtractedTransaction {
  const amtRegex = /(?:NGN|₦|N)\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)/gi;
  const candidates: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = amtRegex.exec(rawText)) !== null) {
    const cleaned = match[1].replace(/,/g, "");
    if (!candidates.includes(cleaned)) {
      candidates.push(cleaned);
    }
  }
  const amountKobo = candidates.length > 0 ? parseNairaStringToKobo(candidates[0]) : null;
  const refMatch = rawText.match(
    /(?:ref(?:erence)?|txn\s*id|session\s*id|trans(?:action)?\s*id)\s*[:#-]?\s*([A-Za-z0-9_-]{4,64})/i,
  );
  const fromMatch = rawText.match(FROM_PATTERN);
  const senderLabel = cleanLabel(fromMatch?.[1]);
  const toMatch = rawText.match(TO_PATTERN);
  const recipientLabel = cleanLabel(toMatch?.[1]);
  const dateMatch = rawText.match(DATE_PATTERN);
  const transactionDate = validateDateToken(dateMatch?.[1]);

  const matchedDirections: string[] = [];
  for (const [pattern, label] of OFFLINE_DIRECTION_RULES) {
    if (pattern.test(rawText) && !matchedDirections.includes(label)) {
      matchedDirections.push(label);
    }
  }
  const transactionDirection =
    matchedDirections.length > 1 ? "Ambiguous" : matchedDirections[0] ?? null;

  const outcomeText = rawText
    .replace(/\b(?:not\s+(?:successful|success|approved|completed)|unsuccessful)\b/gi, " failed ")
    .replace(/\bnot\s+(?:reversed|reversal)\b/gi, " not_reversed ")
    .replace(/\bnot\s+(?:failed|declined)\b/gi, " not_failed ");

  const outcomeStatuses: string[] = [];
  for (const [pattern, label] of OFFLINE_OUTCOME_RULES) {
    if (pattern.test(outcomeText) && !outcomeStatuses.includes(label)) {
      outcomeStatuses.push(label);
    }
  }
  const ambiguousStatus = outcomeStatuses.length > 1;
  const reportedStatus = ambiguousStatus
    ? "Ambiguous (Review Required)"
    : outcomeStatuses[0] ?? null;

  return {
    amount_kobo: amountKobo,
    sender_label: senderLabel,
    recipient_label: recipientLabel,
    reference: refMatch?.[1] ?? null,
    reported_status: reportedStatus,
    transaction_date: transactionDate,
    source_type: sourceType,
    extracted_fields: {
      parser: "offline-regex-v2",
      multiple_amounts_detected: candidates.length > 1,
      candidate_amounts_ngn: candidates,
      transaction_direction: transactionDirection,
      ambiguous_status_detected: ambiguousStatus,
      candidate_statuses: outcomeStatuses,
    },
    disclaimer:
      "Extracted offline from text. This is not independent bank settlement verification.",
  };
}
