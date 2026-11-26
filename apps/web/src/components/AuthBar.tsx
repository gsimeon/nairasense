"use client";

import { useState } from "react";

import { loginUser, registerUser, setStoredToken } from "@/lib/api";

type AuthBarProps = {
  username: string | null;
  onAuthChange: (username: string | null) => Promise<void>;
  onAnnounce: (message: string, speak?: boolean) => void;
};

export function AuthBar({ username, onAuthChange, onAnnounce }: AuthBarProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [userInput, setUserInput] = useState("");
  const [passInput, setPassInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res =
        mode === "register"
          ? await registerUser(userInput.trim(), passInput)
          : await loginUser(userInput.trim(), passInput);
      setStoredToken(res.access_token);
      setOpen(false);
      setPassInput("");
      await onAuthChange(res.username);
      onAnnounce(`Signed in as ${res.username}. Cloud sync is active.`, true);
    } catch (err) {
      onAnnounce(err instanceof Error ? err.message : "Authentication failed.", true);
    } finally {
      setBusy(false);
    }
  }

  if (username) {
    return (
      <div className="auth-inline">
        <span className="hint">Signed in: {username}</span>
        <button
          type="button"
          className="secondary small-btn"
          onClick={async () => {
            setStoredToken(null);
            await onAuthChange(null);
            onAnnounce("Signed out. Local offline storage remains active.", true);
          }}
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="auth-inline">
      <button
        type="button"
        className="secondary small-btn"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        {open ? "Close sign in" : "Sign in / Sync"}
      </button>

      {open && (
        <form onSubmit={handleSubmit} className="panel auth-form" aria-label="Account sign in">
          <div className="actions">
            <button
              type="button"
              className={mode === "login" ? "primary small-btn" : "secondary small-btn"}
              onClick={() => setMode("login")}
            >
              Sign in
            </button>
            <button
              type="button"
              className={mode === "register" ? "primary small-btn" : "secondary small-btn"}
              onClick={() => setMode("register")}
            >
              Create account
            </button>
          </div>
          <div className="field">
            <label htmlFor="auth-username">Username</label>
            <input
              id="auth-username"
              type="text"
              required
              minLength={3}
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="auth-password">Password (8+ characters)</label>
            <input
              id="auth-password"
              type="password"
              required
              minLength={8}
              value={passInput}
              onChange={(e) => setPassInput(e.target.value)}
            />
          </div>
          <button type="submit" className="primary small-btn" disabled={busy}>
            {busy ? "Submitting…" : mode === "register" ? "Create account" : "Sign in"}
          </button>
        </form>
      )}
    </div>
  );
}
