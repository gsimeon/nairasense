"use client";

let lastSpokenText = "";

export function isSpeechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
}

export function stopSpeaking(): void {
  if (!isSpeechSupported()) return;
  window.speechSynthesis.cancel();
}

export function speakText(text: string, options: { enabled: boolean; rate: number; force?: boolean }): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  lastSpokenText = trimmed;

  if (!options.enabled && !options.force) return false;
  if (!isSpeechSupported()) return false;

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(trimmed);
  utterance.lang = "en-NG";
  utterance.rate = Math.min(2.0, Math.max(0.5, options.rate || 1.0));
  window.speechSynthesis.speak(utterance);
  return true;
}

export function repeatLastSpoken(rate: number): boolean {
  if (!lastSpokenText) return false;
  return speakText(lastSpokenText, { enabled: true, rate, force: true });
}

export function getLastSpokenText(): string {
  return lastSpokenText;
}
