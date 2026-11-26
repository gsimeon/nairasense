"use client";

import { NAIRA_DENOMINATIONS } from "./types";

export type VoiceCommand =
  | { type: "confirm" }
  | { type: "reject" }
  | { type: "repeat" }
  | { type: "stop" }
  | { type: "total" }
  | { type: "scan" }
  | { type: "correct"; denomination: number }
  | { type: "unknown"; transcript: string };

interface SpeechRecognitionAlternative {
  transcript: string;
}

interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionEvent extends Event {
  readonly results: ArrayLike<SpeechRecognitionResult>;
}

interface SpeechRecognitionInstance extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const win = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null;
}

export function isVoiceRecognitionSupported(): boolean {
  return getRecognitionCtor() !== null;
}

export function parseVoiceCommand(rawTranscript: string): VoiceCommand {
  const text = rawTranscript.toLowerCase().trim();

  // Check for denomination correction, e.g. "change to 1000" or "correct 500" or "one thousand"
  const wordToNum: Record<string, number> = {
    five: 5,
    ten: 10,
    twenty: 20,
    fifty: 50,
    "one hundred": 100,
    "two hundred": 200,
    "five hundred": 500,
    "one thousand": 1000,
  };

  if (/\b(change|correct|actually|make it)\b/.test(text)) {
    for (const denom of NAIRA_DENOMINATIONS) {
      if (text.includes(String(denom))) {
        return { type: "correct", denomination: denom };
      }
    }
    for (const [phrase, denom] of Object.entries(wordToNum)) {
      if (text.includes(phrase)) {
        return { type: "correct", denomination: denom };
      }
    }
  }

  if (/\b(confirm|yes|accept|add|correct note|save)\b/.test(text)) {
    return { type: "confirm" };
  }
  if (/\b(reject|no|cancel|discard|skip)\b/.test(text)) {
    return { type: "reject" };
  }
  if (/\b(repeat|again|say again)\b/.test(text)) {
    return { type: "repeat" };
  }
  if (/\b(stop|quiet|silence|mute)\b/.test(text)) {
    return { type: "stop" };
  }
  if (/\b(total|balance|how much|sum)\b/.test(text)) {
    return { type: "total" };
  }
  if (/\b(scan|capture|read|check|photo)\b/.test(text)) {
    return { type: "scan" };
  }

  return { type: "unknown", transcript: rawTranscript };
}

export function startVoiceListener(
  onCommand: (cmd: VoiceCommand) => void,
  onStatusChange: (listening: boolean) => void,
): () => void {
  const Ctor = getRecognitionCtor();
  if (!Ctor) {
    onStatusChange(false);
    return () => {};
  }

  const recognition = new Ctor();
  recognition.lang = "en-NG";
  recognition.continuous = true;
  recognition.interimResults = false;

  let manuallyStopped = false;

  recognition.onresult = (event) => {
    const lastIndex = event.results.length - 1;
    if (lastIndex < 0) return;
    const result = event.results[lastIndex];
    if (!result.isFinal || result.length === 0) return;
    const transcript = result[0].transcript;
    onCommand(parseVoiceCommand(transcript));
  };

  recognition.onerror = () => {
    // Let onend handle restart or stop
  };

  recognition.onend = () => {
    if (!manuallyStopped) {
      try {
        recognition.start();
        return;
      } catch {
        // Fall through to stopped
      }
    }
    onStatusChange(false);
  };

  try {
    recognition.start();
    onStatusChange(true);
  } catch {
    onStatusChange(false);
  }

  return () => {
    manuallyStopped = true;
    try {
      recognition.stop();
    } catch {
      // Ignore
    }
    onStatusChange(false);
  };
}
