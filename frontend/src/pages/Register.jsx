import React, { useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

// Mirror of the backend's name formatter (backend/src/utils/names.js) so the
// user sees the tidy-up live, before submitting — the server still
// normalizes authoritatively, this is just the friendly preview.
const formatName = (raw) => {
  if (typeof raw !== "string") return raw;
  const trimmed = raw.replace(/\s+/g, " ").trim();
  if (!trimmed) return trimmed;
  const fmtWord = (w) => {
    if (!w) return w;
    if (/[a-z][A-Z]/.test(w) || /^[a-z]+[A-Z]/.test(w)) return w;
    if (w.length === 1) return w.toUpperCase();
    return w[0].toUpperCase() + w.slice(1).toLowerCase();
  };
  return trimmed.split(" ").map((w) => w.split("-").map(fmtWord).join("-")).join(" ");
};

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const invitedEmail = searchParams.get("email") || "";
  const [name, setName] = useState("");
  const [email, setEmail] = useState(invitedEmail);
  const [password, setPassword] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      // Normalize on submit too, so what's sent matches what the user saw.
      await register(formatName(name), email, password, title);
      navigate("/");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <form onSubmit={submit} className="tfh-card tfh-fade-in" style={{ width: "100%", maxWidth: 380, padding: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 22 }}>
          <img src="/logo.png" alt="PMDAMC" style={{ width: 36, height: 36, objectFit: "contain" }} />
          <span className="tfh-display" style={{ fontSize: 19, fontWeight: 600 }}>Flow Hub</span>
        </div>

        <div className="tfh-display" style={{ fontSize: 22, fontWeight: 600, marginBottom: 4 }}>Create your account</div>
        <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 20 }}>
          {invitedEmail ? "You've been invited — finish setting up your account below." : "Your admin will add you to a workspace after this."}
        </div>

        <label className="tfh-label" htmlFor="name">Name</label>
        <input
          id="name" className="tfh-input" value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => setName((n) => formatName(n))}
          style={{ marginBottom: 14 }} required autoFocus={!!invitedEmail}
        />

        <label className="tfh-label" htmlFor="email">Email</label>
        <input
          id="email" type="email" className="tfh-input" value={email} onChange={(e) => setEmail(e.target.value)}
          style={{ marginBottom: invitedEmail ? 4 : 14 }} required readOnly={!!invitedEmail}
        />
        {invitedEmail && (
          <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginBottom: 14 }}>
            Locked to match your invite — this is what adds you to the workspace automatically.
          </div>
        )}

        <label className="tfh-label" htmlFor="title">Post / designation <span style={{ textTransform: "none", fontWeight: 400, color: "var(--text-faint)" }}>(optional)</span></label>
        <input id="title" className="tfh-input" value={title} onChange={(e) => setTitle(e.target.value)} style={{ marginBottom: 14 }} />

        <label className="tfh-label" htmlFor="password">Password</label>
        <input id="password" type="password" className="tfh-input" value={password} onChange={(e) => setPassword(e.target.value)} style={{ marginBottom: 18 }} minLength={6} required autoFocus={!invitedEmail} />

        {error && <div style={{ fontSize: 12.5, color: "var(--pri-high)", marginBottom: 14 }}>{error}</div>}

        <button className="tfh-btn tfh-btn-accent" style={{ width: "100%", padding: "10px 14px" }} disabled={busy}>
          {busy ? "Creating account…" : "Create account"}
        </button>

        <div style={{ textAlign: "center", fontSize: 12.5, color: "var(--text-dim)", marginTop: 16 }}>
          Already have one? <Link to="/login" style={{ color: "var(--accent)" }}>Sign in</Link>
        </div>
      </form>
    </div>
  );
}