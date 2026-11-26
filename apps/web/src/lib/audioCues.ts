"use client";

export type CueKind = "capture" | "detected" | "confirm" | "warning" | "error";

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) {
    audioCtx = new Ctx();
  }
  if (audioCtx.state === "suspended") {
    void audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function playTone(freq: number, startOffsetSec: number, durationSec: number, gainPeak = 0.08): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime + startOffsetSec;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, now);

  gain.gain.setValueAtTime(0.001, now);
  gain.gain.exponentialRampToValueAtTime(gainPeak, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.001, now + durationSec);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + durationSec + 0.02);
}

export function playCue(kind: CueKind, enabled = true): void {
  if (!enabled || typeof window === "undefined") return;

  if (kind === "capture") {
    playTone(520, 0, 0.07);
    if ("vibrate" in navigator) navigator.vibrate(35);
  } else if (kind === "detected") {
    playTone(587.33, 0, 0.09);
    playTone(880, 0.09, 0.14);
    if ("vibrate" in navigator) navigator.vibrate([40, 40, 60]);
  } else if (kind === "confirm") {
    playTone(659.25, 0, 0.08);
    playTone(987.77, 0.08, 0.14);
    if ("vibrate" in navigator) navigator.vibrate(70);
  } else if (kind === "warning") {
    playTone(392, 0, 0.12);
    playTone(330, 0.13, 0.14);
    if ("vibrate" in navigator) navigator.vibrate([80, 50, 80]);
  } else if (kind === "error") {
    playTone(240, 0, 0.18);
    if ("vibrate" in navigator) navigator.vibrate([120, 60, 120]);
  }
}
