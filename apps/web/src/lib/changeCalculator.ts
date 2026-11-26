import { NAIRA_DENOMINATIONS } from "./types";

export type DenominationCount = {
  denomination: number;
  count: number;
};

export type ChangeBreakdown = {
  receivedNgn: number;
  priceNgn: number;
  differenceNgn: number;
  status: "exact" | "change_due" | "shortfall";
  notes: DenominationCount[];
  remainderNgn: number;
};

export function calculateNairaChange(receivedNgn: number, priceNgn: number): ChangeBreakdown {
  const received = Math.max(0, Math.round(receivedNgn));
  const price = Math.max(0, Math.round(priceNgn));
  const diff = received - price;

  if (diff === 0) {
    return {
      receivedNgn: received,
      priceNgn: price,
      differenceNgn: 0,
      status: "exact",
      notes: [],
      remainderNgn: 0,
    };
  }

  const absAmount = Math.abs(diff);
  let remaining = absAmount;
  const notes: DenominationCount[] = [];

  const descending = [...NAIRA_DENOMINATIONS].sort((a, b) => b - a);
  for (const denom of descending) {
    if (remaining >= denom) {
      const count = Math.floor(remaining / denom);
      notes.push({ denomination: denom, count });
      remaining -= count * denom;
    }
  }

  return {
    receivedNgn: received,
    priceNgn: price,
    differenceNgn: absAmount,
    status: diff > 0 ? "change_due" : "shortfall",
    notes,
    remainderNgn: remaining,
  };
}

export function formatChangeSpeech(breakdown: ChangeBreakdown): string {
  if (breakdown.status === "exact") {
    return `Exact amount. ${breakdown.receivedNgn.toLocaleString("en-NG")} Naira received for ${breakdown.priceNgn.toLocaleString("en-NG")} Naira. No change needed.`;
  }

  const noteParts = breakdown.notes.map(
    (item) => `${item.count} ${item.denomination.toLocaleString("en-NG")} Naira ${item.count === 1 ? "note" : "notes"}`,
  );
  const remainderNote =
    breakdown.remainderNgn > 0 ? `, plus ${breakdown.remainderNgn} Naira coins` : "";

  if (breakdown.status === "change_due") {
    return `Change due is ${breakdown.differenceNgn.toLocaleString("en-NG")} Naira: ${noteParts.join(", ")}${remainderNote}.`;
  }

  return `Shortfall of ${breakdown.differenceNgn.toLocaleString("en-NG")} Naira. Still needed: ${noteParts.join(", ")}${remainderNote}.`;
}
