import { VoiceLanguage } from "./types";

export const LANGUAGE_LABELS: Record<VoiceLanguage, string> = {
  "en-NG": "English (Nigeria)",
  pcm: "Nigerian Pidgin",
  yo: "Yorùbá",
  ha: "Hausa",
  ig: "Igbo",
};

const CURRENCY_WORD: Record<VoiceLanguage, string> = {
  "en-NG": "Naira",
  pcm: "Naira",
  yo: "Náírà",
  ha: "Naira",
  ig: "Naịra",
};

export function formatDetectedNoteSpeech(
  lang: VoiceLanguage,
  denomination: number,
  confidencePercent: number,
): string {
  const amt = denomination.toLocaleString("en-NG");
  switch (lang) {
    case "pcm":
      return `I see ${amt} Naira, ${confidencePercent} percent sure. Talk or press Confirm to add am.`;
    case "yo":
      return `Mo rí Náírà ${amt}, ìdánilójú ìpín ${confidencePercent}. Tẹ Confirm láti fi kún un.`;
    case "ha":
      return `Na ga Naira ${amt}, tabbas kashi ${confidencePercent}. Danna Confirm don ƙarawa.`;
    case "ig":
      return `Ahụrụ m Naịra ${amt}, ntụkwasị obi pasent ${confidencePercent}. Pịa Confirm ka itinye ya.`;
    default:
      return `Detected ${amt} ${CURRENCY_WORD[lang]}, ${confidencePercent} percent confidence. Confirm, correct, or reject before adding to your total.`;
  }
}

export function formatTotalSpeech(lang: VoiceLanguage, total: number, count: number): string {
  const amt = total.toLocaleString("en-NG");
  switch (lang) {
    case "pcm":
      return `Your total money na ${amt} Naira from ${count} ${count === 1 ? "note" : "notes"}.`;
    case "yo":
      return `Àpapọ̀ owó rẹ jẹ́ Náírà ${amt} láti inú ìwé owó ${count}.`;
    case "ha":
      return `Jimillar kuɗinka ita ce Naira ${amt} daga takardu ${count}.`;
    case "ig":
      return `Ngụkọta ego gị bụ Naịra ${amt} site na akwụkwọ ego ${count}.`;
    default:
      return `Current cash total is ${amt} Naira across ${count} confirmed ${count === 1 ? "entry" : "entries"}.`;
  }
}

export function formatAddedSpeech(lang: VoiceLanguage, value: number, nextTotal: number): string {
  const v = value.toLocaleString("en-NG");
  const t = nextTotal.toLocaleString("en-NG");
  switch (lang) {
    case "pcm":
      return `Don add ${v} Naira. Total now na ${t} Naira.`;
    case "yo":
      return `Ti fi Náírà ${v} kún un. Àpapọ̀ báyìí jẹ́ Náírà ${t}.`;
    case "ha":
      return `An ƙara Naira ${v}. Jimilla yanzu ita ce Naira ${t}.`;
    case "ig":
      return `Etinyela Naịra ${v}. Ngụkọta ugbu a bụ Naịra ${t}.`;
    default:
      return `Added ${v} Naira. Current cash total is ${t} Naira.`;
  }
}
