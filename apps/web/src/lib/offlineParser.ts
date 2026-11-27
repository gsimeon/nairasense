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
    amount_requires_confirmation: boolean;
    candidate_amounts_ngn: string[];
    amount_contexts: Record<string, string>;
    labeled_amounts: Array<{ id: string; amount_ngn: string; context: string }>;
    transaction_direction: string | null;
    ambiguous_status_detected: boolean;
    ambiguous_date_detected: boolean;
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
  /(?:from|sender)\s*[:-]?\s*(.+?)(?=\s*(?:\.\s+|\r|\n|\||;|\b(?:to|recipient|beneficiary|ref|reference|date|amt|amount|status)\s*:|\b(?:failed\s+due\s+to|declined\s+due\s+to|due\s+to|was\s+(?:failed|declined|pending|reversed|successful)|transaction\s+(?:failed|declined|pending|reversed|successful))\b|$))/i;
const TO_PATTERN =
  /(?:to|recipient|beneficiary)\s*[:-]?\s*(.+?)(?=\s*(?:\.\s+|\r|\n|\||;|\b(?:from|sender|ref|reference|date|amt|amount|status)\s*:|\b(?:failed\s+due\s+to|declined\s+due\s+to|due\s+to|was\s+(?:failed|declined|pending|reversed|successful)|transaction\s+(?:failed|declined|pending|reversed|successful))\b|$))/i;
const DATE_PATTERN =
  /(?:^|[\s:(])(\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})?)?|\d{2}\/\d{2}\/\d{4}|\d{2}-\d{2}-\d{4})(?=\s|$|[.,;)])/;

function cleanLabel(raw: string | undefined): string | null {
  if (!raw) return null;
  const first = raw.split(/[\r\n|;]+/)[0] ?? "";
  const cleaned = first.replace(/^[\s.,:-]+|[\s.,:-]+$/g, "");
  return cleaned || null;
}

export function validateDateToken(token: string | undefined): string | null {
  if (!token) return null;
  const match = token.match(/^([^\sT]+)(?:[T ](.+))?$/);
  if (!match) return null;
  const datePart = match[1] ?? "";
  const timePart = match[2];
  if (timePart !== undefined) {
    const tMatch = timePart.match(
      /^(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,6})?)?(Z|([+-])(\d{2}):(\d{2}))?$/,
    );
    if (!tMatch) return null;
    const hh = Number(tMatch[1]);
    const mm = Number(tMatch[2]);
    const ss = tMatch[3] !== undefined ? Number(tMatch[3]) : 0;
    if (hh > 23 || mm > 59 || ss > 59) return null;
    if (tMatch[5] !== undefined) {
      const tzHh = Number(tMatch[6]);
      const tzMm = Number(tMatch[7]);
      if (tzHh > 14 || tzMm > 59 || (tzHh === 14 && tzMm !== 0)) return null;
    }
  }
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

function isAmbiguousDate(token: string | null): boolean {
  if (!token) return false;
  const datePart = token.split(/[T ]/)[0] ?? "";
  const match = datePart.match(/^(\d{2})\/(\d{2})\/\d{4}$|^(\d{2})-(\d{2})-\d{4}$/);
  if (!match) return false;
  const first = Number(match[1] ?? match[3]);
  const second = Number(match[2] ?? match[4]);
  return first <= 12 && second <= 12 && first !== second;
}

function classifyAmountContext(rawText: string, startIdx: number): string {
  const prefix = rawText.slice(Math.max(0, startIdx - 40), startIdx).toLowerCase();
  if (/\b(?:avail(?:able)?\s*bal(?:ance)?)\b/.test(prefix)) return "Available Balance";
  if (/\b(?:new\s+balance|current\s+balance|balance|bal)\b/.test(prefix)) return "Balance";
  if (/\b(?:fee|charge|vat|commission)\b/.test(prefix)) return "Fee";
  if (/\brefund\b/.test(prefix)) return "Refund";
  if (/\b(?:amt|amount|debit|debited|credit|credited|transfer|purchase|transaction)\b/.test(prefix)) {
    return "Amount";
  }
  return "Other";
}

export function parseLocallyOffline(
  rawText: string,
  sourceType: SourceType,
): OfflineExtractedTransaction {
  const amtRegex = /(?:NGN|₦|N)\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)/gi;
  const candidates: string[] = [];
  const amountContexts: Record<string, string> = {};
  const labeledAmounts: Array<{ id: string; amount_ngn: string; context: string }> = [];
  let match: RegExpExecArray | null;
  let candIdx = 1;
  while ((match = amtRegex.exec(rawText)) !== null) {
    const cleaned = match[1].replace(/,/g, "");
    const ctxLabel = classifyAmountContext(rawText, match.index);
    labeledAmounts.push({ id: `cand-${candIdx++}`, amount_ngn: cleaned, context: ctxLabel });
    if (!candidates.includes(cleaned)) {
      candidates.push(cleaned);
    }
    if (!(cleaned in amountContexts)) {
      amountContexts[cleaned] = ctxLabel;
    }
  }
  const amountRequiresConfirmation =
    labeledAmounts.length > 1 ||
    (labeledAmounts.length === 1 && labeledAmounts[0]?.context !== "Amount");
  const amountKobo =
    !amountRequiresConfirmation && candidates.length > 0
      ? parseNairaStringToKobo(candidates[0])
      : null;
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

  let outcomeText = rawText
    .replace(/\b(?:not\s+(?:successful|success|approved|completed)|unsuccessful)\b/gi, " failed ");
  if (senderLabel) {
    outcomeText = outcomeText.split(senderLabel).join(" ");
  }
  if (recipientLabel) {
    outcomeText = outcomeText.split(recipientLabel).join(" ");
  }
  outcomeText = outcomeText
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
      multiple_amounts_detected: labeledAmounts.length > 1,
      amount_requires_confirmation: amountRequiresConfirmation,
      candidate_amounts_ngn: candidates,
      amount_contexts: amountContexts,
      labeled_amounts: labeledAmounts,
      transaction_direction: transactionDirection,
      ambiguous_status_detected: ambiguousStatus,
      ambiguous_date_detected: isAmbiguousDate(transactionDate),
      candidate_statuses: outcomeStatuses,
    },
    disclaimer:
      "Extracted offline from text. This is not independent bank settlement verification.",
  };
}
