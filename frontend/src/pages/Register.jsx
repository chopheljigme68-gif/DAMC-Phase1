import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await register(name, email, password, title);
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
        <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 20 }}>Your admin will add you to a workspace after this.</div>

        <label className="tfh-label" htmlFor="name">Name</label>
        <input id="name" className="tfh-input" value={name} onChange={(e) => setName(e.target.value)} style={{ marginBottom: 14 }} required />

        <label className="tfh-label" htmlFor="email">Email</label>
        <input id="email" type="email" className="tfh-input" value={email} onChange={(e) => setEmail(e.target.value)} style={{ marginBottom: 14 }} required />

        <label className="tfh-label" htmlFor="title">Post / designation <span style={{ textTransform: "none", fontWeight: 400, color: "var(--text-faint)" }}>(optional)</span></label>
        <input id="title" className="tfh-input" value={title} onChange={(e) => setTitle(e.target.value)} style={{ marginBottom: 14 }} />

        <label className="tfh-label" htmlFor="password">Password</label>
        <input id="password" type="password" className="tfh-input" value={password} onChange={(e) => setPassword(e.target.value)} style={{ marginBottom: 18 }} minLength={6} required />

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
