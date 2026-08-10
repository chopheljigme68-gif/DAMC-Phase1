import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Mail } from "lucide-react";
import { api } from "../api.js";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api.forgotPassword(email);
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div className="tfh-card tfh-fade-in" style={{ width: "100%", maxWidth: 380, padding: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 22 }}>
          <img src="/logo.png" alt="Team Flow Hub" style={{ width: 36, height: 36, objectFit: "contain" }} />
          <span className="tfh-display" style={{ fontSize: 19, fontWeight: 600 }}>Flow Hub</span>
        </div>

        {sent ? (
          <>
            <div style={{ width: 44, height: 44, borderRadius: 999, background: "var(--accent-soft)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
              <Mail size={20} color="var(--accent)" />
            </div>
            <div className="tfh-display" style={{ fontSize: 20, fontWeight: 600, marginBottom: 6 }}>Check your inbox</div>
            <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 22, lineHeight: 1.5 }}>
              If an account exists for <strong>{email}</strong>, a reset link is on its way. It's valid for 1 hour.
            </div>
            <Link to="/login" className="tfh-btn" style={{ width: "100%", justifyContent: "center", textDecoration: "none" }}>
              Back to sign in
            </Link>
          </>
        ) : (
          <form onSubmit={submit}>
            <div className="tfh-display" style={{ fontSize: 22, fontWeight: 600, marginBottom: 4 }}>Forgot password?</div>
            <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 20 }}>Enter your email and we'll send you a reset link.</div>

            <label className="tfh-label" htmlFor="email">Email</label>
            <input id="email" type="email" className="tfh-input" value={email} onChange={(e) => setEmail(e.target.value)} style={{ marginBottom: 18 }} required />

            {error && <div style={{ fontSize: 12.5, color: "var(--pri-high)", marginBottom: 14 }}>{error}</div>}

            <button className="tfh-btn tfh-btn-accent" style={{ width: "100%", padding: "10px 14px" }} disabled={busy}>
              {busy ? "Sending…" : "Send reset link"}
            </button>

            <div style={{ textAlign: "center", fontSize: 12.5, color: "var(--text-dim)", marginTop: 16 }}>
              <Link to="/login" style={{ color: "var(--accent)" }}>Back to sign in</Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
