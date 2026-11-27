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
): string {
  const amt = denomination.toLocaleString("en-NG");
  switch (lang) {
    case "pcm":
      return `E be like ${amt} Naira. Abeg check am well, press Confirm or Correct.`;
    case "yo":
      return `Ó dà bí Náírà ${amt}. Jọ̀wọ́ ṣàyẹ̀wò rẹ̀, tẹ Confirm tàbí Correct.`;
    case "ha":
      return `Kamar Naira ${amt} ne. A duba sosai, a danna Confirm ko Correct.`;
    case "ig":
      return `Ọ dị ka Naịra ${amt}. Biko lelee ya, pịa Confirm ma ọ bụ Correct.`;
    default:
      return `Possible ${amt} ${CURRENCY_WORD[lang]} note. Please confirm, correct, or reject before adding to your total.`;
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
