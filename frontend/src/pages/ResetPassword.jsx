import React, { useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { connectSocket } from "../socket.js";

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const navigate = useNavigate();
  const { setUser } = useAuth();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (password !== confirm) return setError("Passwords don't match.");
    if (password.length < 6) return setError("Password must be at least 6 characters.");

    setBusy(true);
    try {
      const { token: authToken, user } = await api.resetPassword(token, password);
      api.setToken(authToken);
      setUser(user);
      connectSocket();
      setDone(true);
      setTimeout(() => navigate("/"), 1200);
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

        {!token ? (
          <>
            <div className="tfh-display" style={{ fontSize: 20, fontWeight: 600, marginBottom: 6 }}>Missing reset link</div>
            <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 18 }}>Open this page from the link in your email, or request a new one.</div>
            <Link to="/forgot-password" className="tfh-btn tfh-btn-accent" style={{ width: "100%", justifyContent: "center", textDecoration: "none" }}>Request a new link</Link>
          </>
        ) : done ? (
          <>
            <div style={{ width: 44, height: 44, borderRadius: 999, background: "var(--accent-soft)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
              <CheckCircle2 size={20} color="var(--accent)" />
            </div>
            <div className="tfh-display" style={{ fontSize: 20, fontWeight: 600, marginBottom: 6 }}>Password updated</div>
            <div style={{ fontSize: 13, color: "var(--text-dim)" }}>Taking you in…</div>
          </>
        ) : (
          <form onSubmit={submit}>
            <div className="tfh-display" style={{ fontSize: 22, fontWeight: 600, marginBottom: 4 }}>Set a new password</div>
            <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 20 }}>Choose something you haven't used before.</div>

            <label className="tfh-label" htmlFor="password">New password</label>
            <input id="password" type="password" className="tfh-input" value={password} onChange={(e) => setPassword(e.target.value)} style={{ marginBottom: 14 }} minLength={6} required />

            <label className="tfh-label" htmlFor="confirm">Confirm password</label>
            <input id="confirm" type="password" className="tfh-input" value={confirm} onChange={(e) => setConfirm(e.target.value)} style={{ marginBottom: 18 }} minLength={6} required />

            {error && <div style={{ fontSize: 12.5, color: "var(--pri-high)", marginBottom: 14 }}>{error}</div>}

            <button className="tfh-btn tfh-btn-accent" style={{ width: "100%", padding: "10px 14px" }} disabled={busy}>
              {busy ? "Updating…" : "Update password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
