import React, { useEffect, useMemo, useRef, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import {
  LayoutDashboard, Columns3, Users, CalendarDays, Search, Plus, X, Check,
  Flag, ChevronLeft, ChevronRight, Trash2, GripVertical, ArrowRight, Menu, Sparkles,
  Bell, Crown, Sun, Moon, LogOut, AlertTriangle, Loader2, RefreshCw,
  UserPlus, ChevronDown, ChevronUp, Building2, Shield, FolderKanban, Lock,
  Paperclip, FileText, Image as ImageIcon, Download, Upload, Pencil, MessageSquare, FolderOpen, Link2, Clock, ClipboardList, BookOpen, Table as TableIcon, CheckCircle2, UserX,
} from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  ResponsiveContainer, Cell,
} from "recharts";

import { useAuth } from "./context/AuthContext.jsx";
import { useTheme } from "./context/ThemeContext.jsx";
import { useWorkspace } from "./context/WorkspaceContext.jsx";
import { useProject } from "./context/ProjectContext.jsx";
import { api } from "./api.js";
import { connectSocket, getSocket } from "./socket.js";
import Login from "./pages/Login.jsx";
import Register from "./pages/Register.jsx";
import ForgotPassword from "./pages/ForgotPassword.jsx";
import ResetPassword from "./pages/ResetPassword.jsx";

/* ------------------------------------------------------------------ */
/* Constants                                                            */
/* ------------------------------------------------------------------ */
const STAGES = [
  { id: "todo", label: "Tasks", color: "var(--stage-progress)" },
  { id: "done", label: "Completed", color: "var(--stage-done)" },
];
const PRIORITIES = {
  low: { label: "Low", color: "var(--pri-low)" },
  medium: { label: "Medium", color: "var(--pri-medium)" },
  high: { label: "High", color: "var(--pri-high)" },
};
const NAV = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "board", label: "Board", icon: Columns3 },
  { id: "files", label: "Files", icon: FolderOpen },
  { id: "milestones", label: "Milestones", icon: Flag },
  { id: "team", label: "Team", icon: Users },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "activity", label: "Activity Log", icon: BookOpen },
  { id: "admin", label: "Admin Panel", icon: Shield },
];
const NOTIF_LABEL = {
  assigned: "assigned you a task",
  reassigned: "reassigned a task to you",
  moved: "task moved",
  shipped: "task shipped",
  role: "role updated",
  removed: "removed from workspace",
  comment: "new comment",
  link: "new link",
  invited: "added to workspace",
  due_soon: "due soon",
};

const POST_SUGGESTIONS = [
  "Founder", "Director", "Manager", "Team Lead",
  "Product Designer", "Product Manager", "Software Engineer", "QA Engineer",
  "Marketing Lead", "Sales Lead", "Operations Lead", "Analyst",
];

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */
const memberById = (users, id) => users.find((u) => u.id === id);

const formatTimeLabel = (hhmm) => {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
};

// Matches the backend's own multer limit (20MB for task/subtask/project/
// milestone files) — checked client-side too so an oversized file is
// rejected instantly instead of after a slow upload attempt that was
// always going to fail.
const MAX_FILE_MB = 20;
const validateFiles = (fileList) => {
  const files = Array.from(fileList || []);
  const accepted = [];
  const rejected = [];
  for (const f of files) {
    if (f.size > MAX_FILE_MB * 1024 * 1024) rejected.push(f.name);
    else accepted.push(f);
  }
  return { accepted, rejected };
};

const dueMeta = (dateStr, status) => {
  if (status === "done") return { label: "Completed", tone: "var(--stage-done)" };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(dateStr + "T00:00:00");
  const diff = Math.round((due - today) / 86400000);
  if (diff < 0) return { label: `${Math.abs(diff)}d overdue`, tone: "var(--pri-high)" };
  if (diff === 0) return { label: "Due today", tone: "var(--pri-medium)" };
  if (diff === 1) return { label: "Due tomorrow", tone: "var(--pri-medium)" };
  return { label: `Due in ${diff}d`, tone: "var(--text-dim)" };
};
const timeAgo = (iso) => {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
};

/* ------------------------------------------------------------------ */
/* Small shared pieces                                                  */
/* ------------------------------------------------------------------ */
const Logo = ({ size = 30 }) => (
  <img src="/logo.png" alt="PMDAMC" style={{ width: size, height: size, objectFit: "contain", flexShrink: 0 }} />
);

// Shared across all <Avatar> instances so the same person's photo is only
// fetched once per session, however many task cards/avatars show them.
const avatarUrlCache = new Map();

const useAvatarPhoto = (member) => {
  const [url, setUrl] = useState(() => (member?.avatarUrl && avatarUrlCache.get(member.id)) || null);
  useEffect(() => {
    if (!member?.avatarUrl) { setUrl(null); return; }
    if (avatarUrlCache.has(member.id)) { setUrl(avatarUrlCache.get(member.id)); return; }
    let cancelled = false;
    api.getAvatarBlobUrl(member.id)
      .then((blobUrl) => { avatarUrlCache.set(member.id, blobUrl); if (!cancelled) setUrl(blobUrl); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [member?.id, member?.avatarUrl]);
  return url;
};

// Call after a fresh avatar upload so every Avatar on screen picks up the new photo.
const invalidateAvatarCache = (userId) => { avatarUrlCache.delete(userId); };

const Avatar = ({ member, size = 28 }) => {
  const photoUrl = useAvatarPhoto(member);
  return (
    <span
      className="tfh-avatar"
      title={member ? `${member.name}${member.role === "admin" ? " · Admin" : member.role === "lead" ? " · Lead" : ""}` : "Assigned to someone no longer on the team"}
      style={{ width: size, height: size, background: member?.color || "var(--raised)", border: member ? undefined : "1px dashed var(--text-faint)", fontSize: size * 0.4, overflow: "hidden" }}
    >
      {photoUrl ? (
        <img src={photoUrl} alt={member.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : member ? (
        member.initials
      ) : (
        <UserX size={size * 0.55} color="var(--text-faint)" />
      )}
      {member?.role === "lead" && (
        <Crown size={size * 0.42} color="#12141c" fill="var(--accent)" style={{ position: "absolute", top: -size * 0.32, right: -size * 0.12 }} />
      )}
      {member?.role === "admin" && (
        <Shield size={size * 0.4} color="#12141c" fill="var(--stage-done)" style={{ position: "absolute", top: -size * 0.3, right: -size * 0.14 }} />
      )}
    </span>
  );
};

const PriorityChip = ({ level }) => {
  const p = PRIORITIES[level];
  return (
    <span className="tfh-chip" style={{ background: `${p.color}1E`, color: p.color, borderColor: `${p.color}40` }}>
      <Flag size={11} /> {p.label}
    </span>
  );
};

const MiniCheckbox = ({ checked, onClick, disabled }) => (
  <button type="button" onClick={onClick} disabled={disabled} className={`tfh-checkbox ${checked ? "checked" : ""}`} style={disabled ? { opacity: 0.6, cursor: "default" } : undefined} aria-label="Toggle subtask">
    {checked && <Check size={11} color="#12141c" strokeWidth={3} />}
  </button>
);

const Spinner = ({ size = 22 }) => <Loader2 className="tfh-pulse" size={size} color="var(--text-faint)" />;

/* ------------------------------------------------------------------ */
/* Task card + column                                                   */
/* ------------------------------------------------------------------ */
const TaskCard = ({ task, users, onOpen, onComplete, onReopen, canManage, currentUserId, showProject }) => {
  const assignee = memberById(users, task.assigneeId);
  const done = task.subtasks.filter((s) => s.done).length;
  const total = task.subtasks.length;
  const meta = dueMeta(task.due, task.status);
  const isDone = task.status === "done";
  // A manager can toggle any card's completion. A plain member can toggle
  // only a card assigned to them — everyone else's tasks stay view-only.
  const canModify = canManage || task.assigneeId === currentUserId;

  return (
    <div
      className="tfh-card tfh-task-card tfh-stagger"
      onClick={() => onOpen(task)}
      style={{
        padding: "12px 13px", cursor: "pointer", display: "flex", flexDirection: "column", gap: 10,
        borderColor: isDone ? "var(--accent)" : undefined,
        background: isDone ? "var(--accent-soft)" : undefined,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.35, textDecoration: isDone ? "line-through" : "none", color: isDone ? "var(--text-dim)" : "var(--text)" }}>{task.title}</span>
        {canModify && (
          <button
            onClick={(e) => { e.stopPropagation(); isDone ? onReopen(task.id) : onComplete(task.id); }}
            className="tfh-btn tfh-btn-ghost"
            style={{ padding: 3, flexShrink: 0 }}
            aria-label={isDone ? "Mark not done" : "Mark complete"}
            title={isDone ? "Click to reopen" : "Mark complete"}
          >
            <CheckCircle2 size={16} color={isDone ? "var(--accent)" : "var(--text-faint)"} fill={isDone ? "var(--accent)" : "none"} />
          </button>
        )}
        {!canModify && isDone && <CheckCircle2 size={16} color="var(--accent)" style={{ flexShrink: 0, marginTop: 1 }} />}
      </div>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
        {showProject && task.projectName && (
          <span className="tfh-chip" style={{ background: "var(--raised)", color: "var(--text-dim)", maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            <FolderKanban size={10} /> {task.projectName}
          </span>
        )}
        {task.dueTime && (
          <span className="tfh-chip tfh-mono" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
            <Clock size={10} /> {formatTimeLabel(task.dueTime)}
          </span>
        )}
        <PriorityChip level={task.priority} />
        {total > 0 && (
          <span className="tfh-chip tfh-mono" style={{ background: "var(--raised)", color: "var(--text-dim)" }}>
            {done}/{total}
          </span>
        )}
        {task.attachmentCount > 0 && (
          <span className="tfh-chip tfh-mono" style={{ background: "var(--raised)", color: "var(--text-dim)" }}>
            <Paperclip size={10} /> {task.attachmentCount}
          </span>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11.5, color: isDone ? "var(--accent)" : meta.tone, fontWeight: 500 }}>{meta.label}</span>
        <Avatar member={assignee} size={24} />
      </div>
    </div>
  );
};

const Column = ({ stage, tasks, users, onOpen, onAdd, onComplete, onReopen, canManage, canCreate, currentUserId, showProject }) => {
  return (
    <div className="tfh-card" style={{ padding: 12, display: "flex", flexDirection: "column", minHeight: 200 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "2px 4px 12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: stage.color }} />
          <span style={{ fontSize: 13, fontWeight: 700 }}>{stage.label}</span>
          <span className="tfh-mono" style={{ fontSize: 11, color: "var(--text-faint)" }}>{tasks.length}</span>
        </div>
        {canCreate && (
          <button className="tfh-btn tfh-btn-ghost" style={{ padding: 5 }} onClick={() => onAdd(stage.id)} aria-label={`Add task to ${stage.label}`}>
            <Plus size={14} />
          </button>
        )}
      </div>
      <div className="tfh-scrollbar-none" style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 60, borderRadius: 10, padding: 4, flex: 1 }}>
        {tasks.length === 0 && (
          <div style={{ fontSize: 12, color: "var(--text-faint)", textAlign: "center", padding: "18px 8px", border: "1px dashed var(--line)", borderRadius: 10 }}>
            {canCreate ? "Nothing here — add one." : "Nothing here."}
          </div>
        )}
        {tasks.map((t) => (
          <TaskCard key={t.id} task={t} users={users} onOpen={onOpen} onComplete={onComplete} onReopen={onReopen} canManage={canManage} currentUserId={currentUserId} showProject={showProject} />
        ))}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Task dialog                                                          */
/* ------------------------------------------------------------------ */
const emptyDraft = (status, users, currentUserId, projectId) => ({
  id: null, title: "", description: "", status: status || "todo", priority: "medium",
  assigneeId: currentUserId || users[0]?.id || "", due: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
  dueTime: "", subtasks: [], pendingLinks: [], pendingFiles: [], projectId: projectId || "",
});

const DeleteButton = ({ onConfirm }) => {
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 2500); return () => clearTimeout(t); }, [armed]);
  return armed ? (
    <button className="tfh-btn tfh-btn-danger" onClick={onConfirm}><Trash2 size={13} /> Click to confirm</button>
  ) : (
    <button className="tfh-btn tfh-btn-ghost" style={{ color: "var(--text-dim)" }} onClick={() => setArmed(true)}>
      <Trash2 size={13} /> Delete task
    </button>
  );
};

const AttachmentRow = ({ attachment, workspaceId, projectId, taskId, onRemove }) => {
  const isImage = attachment.mimeType.startsWith("image/");
  const [blobUrl, setBlobUrl] = useState(null);

  useEffect(() => {
    let objectUrl;
    if (isImage) {
      api.getAttachmentBlobUrl(workspaceId, projectId, taskId, attachment.id)
        .then((url) => { objectUrl = url; setBlobUrl(url); })
        .catch(() => {});
    }
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachment.id]);

  const openOrDownload = async () => {
    try {
      const url = await api.getAttachmentBlobUrl(workspaceId, projectId, taskId, attachment.id);
      const a = document.createElement("a");
      a.href = url;
      if (isImage) a.target = "_blank"; else a.download = attachment.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch {
      // silently ignore — the row will still be there to retry
    }
  };

  const sizeLabel = attachment.sizeBytes > 1024 * 1024
    ? `${(attachment.sizeBytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(attachment.sizeBytes / 1024))} KB`;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "6px 8px", borderRadius: 8, background: "var(--raised)" }}>
      {isImage ? (
        blobUrl ? (
          <img src={blobUrl} alt={attachment.fileName} onClick={openOrDownload} style={{ width: 32, height: 32, borderRadius: 6, objectFit: "cover", flexShrink: 0, cursor: "pointer" }} />
        ) : (
          <div style={{ width: 32, height: 32, borderRadius: 6, background: "var(--panel)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <ImageIcon size={14} color="var(--text-faint)" />
          </div>
        )
      ) : (
        <div style={{ width: 32, height: 32, borderRadius: 6, background: "var(--panel)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <FileText size={14} color="var(--text-faint)" />
        </div>
      )}
      <button type="button" onClick={openOrDownload} style={{ flex: 1, minWidth: 0, textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
        <div style={{ fontSize: 12.5, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{attachment.fileName}</div>
        <div style={{ fontSize: 10.5, color: "var(--text-faint)" }}>{sizeLabel}{attachment.uploaderName ? ` · ${attachment.uploaderName}` : ""}</div>
      </button>
      <button type="button" onClick={openOrDownload} className="tfh-btn tfh-btn-ghost" style={{ padding: 5 }} aria-label="Download"><Download size={13} color="var(--text-faint)" /></button>
      {onRemove && <button type="button" onClick={onRemove} className="tfh-btn tfh-btn-ghost" style={{ padding: 5 }} aria-label="Remove attachment"><X size={13} color="var(--text-faint)" /></button>}
    </div>
  );
};

const Attachments = ({ workspaceId, projectId, taskId, canAttach }) => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef(null);

  const load = async () => {
    setLoading(true);
    try {
      const { attachments } = await api.getAttachments(workspaceId, projectId, taskId);
      setItems(attachments);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [taskId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setUploading(true);
    setError("");
    try {
      for (const file of files) {
        await api.uploadAttachment(workspaceId, projectId, taskId, file);
      }
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removeAttachment = async (id) => {
    try {
      await api.deleteAttachment(workspaceId, projectId, taskId, id);
      setItems((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div style={{ marginBottom: 20 }}>
      <label className="tfh-label">Attachments</label>
      {loading ? (
        <div style={{ fontSize: 12, color: "var(--text-faint)", padding: "6px 0" }}>Loading…</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: canAttach ? 10 : 0 }}>
          {items.map((a) => (
            <AttachmentRow key={a.id} attachment={a} workspaceId={workspaceId} projectId={projectId} taskId={taskId} onRemove={canAttach ? () => removeAttachment(a.id) : null} />
          ))}
          {items.length === 0 && <div style={{ fontSize: 12, color: "var(--text-faint)" }}>No files yet.</div>}
        </div>
      )}
      {canAttach && (
        <>
          <input ref={fileInputRef} type="file" multiple style={{ display: "none" }} onChange={(e) => handleFiles(e.target.files)} />
          <button type="button" className="tfh-btn" style={{ fontSize: 12.5 }} onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            <Upload size={13} /> {uploading ? "Uploading…" : "Add photo or file"}
          </button>
        </>
      )}
      {error && <div style={{ fontSize: 12, color: "var(--pri-high)", marginTop: 8 }}>{error}</div>}
    </div>
  );
};

const Links = ({ workspaceId, projectId, taskId, canAttach }) => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkText, setBulkText] = useState("");

  const load = async () => {
    try {
      const { links } = await api.getLinks(workspaceId, projectId, taskId);
      setItems(links);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [taskId]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e) => {
    e.preventDefault();
    if (!url.trim()) return;
    setAdding(true);
    setError("");
    try {
      const { link } = await api.addLink(workspaceId, projectId, taskId, label.trim(), url.trim());
      setItems((prev) => [...prev, link]);
      setLabel("");
      setUrl("");
    } catch (err) {
      setError(err.message);
    } finally {
      setAdding(false);
    }
  };

  const submitBulk = async (e) => {
    e.preventDefault();
    const lines = bulkText.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return;
    setAdding(true);
    setError("");
    try {
      const created = [];
      for (const line of lines) {
        // "Label | https://..." or just a bare URL, label optional either way
        const [maybeLabel, maybeUrl] = line.includes("|") ? line.split("|").map((s) => s.trim()) : [null, line];
        const finalUrl = maybeUrl || line;
        const finalLabel = maybeLabel || (() => { try { return new URL(finalUrl).hostname.replace(/^www\./, ""); } catch { return finalUrl; } })();
        const { link } = await api.addLink(workspaceId, projectId, taskId, finalLabel, finalUrl);
        created.push(link);
      }
      setItems((prev) => [...prev, ...created]);
      setBulkText("");
      setBulkMode(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setAdding(false);
    }
  };

  const remove = async (id) => {
    try {
      await api.deleteLink(workspaceId, projectId, taskId, id);
      setItems((prev) => prev.filter((l) => l.id !== id));
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <label className="tfh-label">Links</label>
        {canAttach && (
          <button type="button" onClick={() => setBulkMode((v) => !v)} style={{ background: "none", border: "none", color: "var(--accent)", fontSize: 11, padding: 0, marginBottom: 6 }}>
            {bulkMode ? "Add one at a time" : "Paste multiple"}
          </button>
        )}
      </div>
      {loading ? (
        <div style={{ fontSize: 12, color: "var(--text-faint)", padding: "6px 0" }}>Loading…</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: canAttach ? 10 : 0 }}>
          {items.map((l) => (
            <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 9, padding: "6px 8px", borderRadius: 8, background: "var(--raised)" }}>
              <Link2 size={14} color="var(--text-faint)" style={{ flexShrink: 0 }} />
              <a href={l.url} target="_blank" rel="noopener noreferrer" style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: "var(--accent)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textDecoration: "none" }}>
                {l.label}
              </a>
              {canAttach && <button type="button" onClick={() => remove(l.id)} className="tfh-btn tfh-btn-ghost" style={{ padding: 5 }} aria-label="Remove link"><X size={13} color="var(--text-faint)" /></button>}
            </div>
          ))}
          {items.length === 0 && <div style={{ fontSize: 12, color: "var(--text-faint)" }}>No links yet.</div>}
        </div>
      )}
      {canAttach && (
        bulkMode ? (
          <form onSubmit={submitBulk}>
            <textarea
              className="tfh-input" rows={4} style={{ resize: "vertical", fontFamily: "IBM Plex Mono, monospace", fontSize: 12, marginBottom: 8 }}
              placeholder={"Design doc | https://docs.google.com/...\nhttps://drive.google.com/... (label optional)"}
              value={bulkText} onChange={(e) => setBulkText(e.target.value)}
            />
            <button className="tfh-btn tfh-btn-accent" disabled={adding || !bulkText.trim()} style={{ width: "100%" }}>
              {adding ? "Adding…" : "Add all links"}
            </button>
          </form>
        ) : (
          <form onSubmit={submit} style={{ display: "flex", gap: 6 }}>
            <input className="tfh-input" placeholder="Label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} style={{ flex: "0 0 40%" }} />
            <input className="tfh-input" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
            <button className="tfh-btn" disabled={adding || !url.trim()} style={{ flexShrink: 0 }}><Plus size={14} /></button>
          </form>
        )
      )}
      {error && <div style={{ fontSize: 12, color: "var(--pri-high)", marginTop: 8 }}>{error}</div>}
    </div>
  );
};

const formatCommentTime = (iso) => {
  const d = new Date(iso);
  const diffMin = Math.round((Date.now() - d.getTime()) / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffMin < 24 * 60) return `${Math.round(diffMin / 60)}h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

const Comments = ({ workspaceId, projectId, taskId, canComment, currentUserId }) => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const listRef = useRef(null);

  const load = async () => {
    try {
      const { comments } = await api.getComments(workspaceId, projectId, taskId);
      setItems(comments);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [taskId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [items.length]);

  const submit = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    setError("");
    try {
      const { comment } = await api.addComment(workspaceId, projectId, taskId, text.trim());
      setItems((prev) => [...prev, comment]);
      setText("");
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{ marginBottom: 20 }}>
      <label className="tfh-label">Comments</label>
      {loading ? (
        <div style={{ fontSize: 12, color: "var(--text-faint)", padding: "6px 0" }}>Loading…</div>
      ) : (
        <div ref={listRef} style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 220, overflowY: "auto", marginBottom: 10, padding: items.length ? "2px 2px" : 0 }}>
          {items.map((c) => {
            const mine = c.userId === currentUserId;
            const author = { id: c.userId, name: c.userName || "Someone", color: c.userColor, initials: c.userInitials, avatarUrl: c.userAvatarUrl };
            return (
              <div key={c.id} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <Avatar member={author} size={24} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{mine ? "You" : c.userName}</span>
                    <span style={{ fontSize: 10.5, color: "var(--text-faint)" }}>{formatCommentTime(c.createdAt)}</span>
                  </div>
                  <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.4, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{c.body}</div>
                </div>
              </div>
            );
          })}
          {items.length === 0 && <div style={{ fontSize: 12, color: "var(--text-faint)" }}>No comments yet.</div>}
        </div>
      )}
      {canComment ? (
        <form onSubmit={submit} style={{ display: "flex", gap: 8 }}>
          <input className="tfh-input" placeholder="Write a comment…" value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} />
          <button className="tfh-btn tfh-btn-accent" disabled={sending || !text.trim()} style={{ flexShrink: 0 }}>{sending ? "…" : "Send"}</button>
        </form>
      ) : (
        <div style={{ fontSize: 11.5, color: "var(--text-faint)" }}>Only the admin, lead, or the assignee can comment here.</div>
      )}
      {error && <div style={{ fontSize: 12, color: "var(--pri-high)", marginTop: 8 }}>{error}</div>}
    </div>
  );
};

const SubtaskAttachmentsMini = ({ workspaceId, projectId, taskId, subtaskId, canManage }) => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    api.getSubtaskAttachments(workspaceId, projectId, taskId, subtaskId)
      .then(({ attachments }) => setItems(attachments))
      .finally(() => setLoading(false));
  }, [workspaceId, projectId, taskId, subtaskId]);

  const handleFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setUploading(true);
    try {
      for (const file of files) await api.uploadSubtaskAttachment(workspaceId, projectId, taskId, subtaskId, file);
      const { attachments } = await api.getSubtaskAttachments(workspaceId, projectId, taskId, subtaskId);
      setItems(attachments);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const openFile = async (attachmentId, fileName, isImage) => {
    const url = await api.getSubtaskAttachmentBlobUrl(workspaceId, projectId, taskId, subtaskId, attachmentId);
    const a = document.createElement("a");
    a.href = url;
    if (isImage) a.target = "_blank"; else a.download = fileName;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const remove = async (id) => {
    await api.deleteSubtaskAttachment(workspaceId, projectId, taskId, subtaskId, id);
    setItems((prev) => prev.filter((a) => a.id !== id));
  };

  return (
    <div>
      <div className="tfh-label" style={{ fontSize: 10 }}>Files</div>
      {loading ? <div style={{ fontSize: 11, color: "var(--text-faint)" }}>Loading…</div> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: canManage ? 6 : 0 }}>
          {items.map((a) => (
            <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 7, padding: "4px 7px", borderRadius: 6, background: "var(--panel)" }}>
              <Paperclip size={11} color="var(--text-faint)" />
              <button type="button" onClick={() => openFile(a.id, a.fileName, a.mimeType.startsWith("image/"))} style={{ flex: 1, minWidth: 0, textAlign: "left", background: "none", border: "none", fontSize: 11.5, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.fileName}</button>
              {canManage && <button type="button" onClick={() => remove(a.id)} className="tfh-btn tfh-btn-ghost" style={{ padding: 2 }} aria-label="Remove"><X size={10} /></button>}
            </div>
          ))}
          {items.length === 0 && <div style={{ fontSize: 11, color: "var(--text-faint)" }}>No files.</div>}
        </div>
      )}
      {canManage && (
        <>
          <input ref={fileInputRef} type="file" multiple style={{ display: "none" }} onChange={(e) => handleFiles(e.target.files)} />
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading} className="tfh-btn tfh-btn-ghost" style={{ fontSize: 10.5, padding: "3px 7px" }}>
            <Upload size={10} /> {uploading ? "Uploading…" : "Add file"}
          </button>
        </>
      )}
    </div>
  );
};

const SubtaskLinksMini = ({ workspaceId, projectId, taskId, subtaskId, canManage }) => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getSubtaskLinks(workspaceId, projectId, taskId, subtaskId)
      .then(({ links }) => setItems(links))
      .finally(() => setLoading(false));
  }, [workspaceId, projectId, taskId, subtaskId]);

  const submit = async (e) => {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    try {
      const { link } = await api.addSubtaskLink(workspaceId, projectId, taskId, subtaskId, label.trim(), url.trim());
      setItems((prev) => [...prev, link]);
      setLabel(""); setUrl("");
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id) => {
    await api.deleteSubtaskLink(workspaceId, projectId, taskId, subtaskId, id);
    setItems((prev) => prev.filter((l) => l.id !== id));
  };

  return (
    <div>
      <div className="tfh-label" style={{ fontSize: 10 }}>Links</div>
      {loading ? <div style={{ fontSize: 11, color: "var(--text-faint)" }}>Loading…</div> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: canManage ? 6 : 0 }}>
          {items.map((l) => (
            <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 7, padding: "4px 7px", borderRadius: 6, background: "var(--panel)" }}>
              <Link2 size={11} color="var(--text-faint)" />
              <a href={l.url} target="_blank" rel="noopener noreferrer" style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: "var(--accent)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textDecoration: "none" }}>{l.label}</a>
              {canManage && <button type="button" onClick={() => remove(l.id)} className="tfh-btn tfh-btn-ghost" style={{ padding: 2 }} aria-label="Remove"><X size={10} /></button>}
            </div>
          ))}
          {items.length === 0 && <div style={{ fontSize: 11, color: "var(--text-faint)" }}>No links.</div>}
        </div>
      )}
      {canManage && (
        <form onSubmit={submit} style={{ display: "flex", gap: 5 }}>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label" className="tfh-input" style={{ fontSize: 11, flex: "0 0 36%" }} />
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className="tfh-input" style={{ fontSize: 11 }} />
          <button className="tfh-btn tfh-btn-ghost" disabled={busy || !url.trim()} style={{ padding: "3px 7px", flexShrink: 0 }}><Plus size={11} /></button>
        </form>
      )}
    </div>
  );
};

const NewSubtaskForm = ({ onAdd, onCancel }) => {
  const [text, setText] = useState("");
  const [description, setDescription] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [links, setLinks] = useState([]);
  const [linkLabel, setLinkLabel] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [files, setFiles] = useState([]);
  const [fileError, setFileError] = useState("");
  const fileInputRef = useRef(null);
  const titleRef = useRef(null);
  useEffect(() => { titleRef.current?.focus(); }, []);

  const addLink = (e) => {
    e.preventDefault();
    if (!linkUrl.trim()) return;
    setLinks((prev) => [...prev, { label: linkLabel.trim() || linkUrl.trim(), url: linkUrl.trim() }]);
    setLinkLabel(""); setLinkUrl("");
  };
  const removeLink = (i) => setLinks((prev) => prev.filter((_, idx) => idx !== i));

  const handleFiles = (fileList) => {
    const { accepted, rejected } = validateFiles(fileList);
    if (accepted.length) setFiles((prev) => [...prev, ...accepted]);
    if (rejected.length) setFileError(`${rejected.join(", ")} — over the ${MAX_FILE_MB}MB limit, not added.`);
    else setFileError("");
  };
  const removeFile = (i) => setFiles((prev) => prev.filter((_, idx) => idx !== i));

  const submit = (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    onAdd({ text: text.trim(), description, startTime, endTime, pendingLinks: links, pendingFiles: files });
  };

  return (
    <form onSubmit={submit} className="tfh-card" style={{ padding: 14, background: "var(--raised)", borderColor: "var(--accent)" }}>
      <label className="tfh-label" style={{ fontSize: 10 }}>Subtask title</label>
      <input ref={titleRef} className="tfh-input" placeholder="What's this mini task?" value={text} onChange={(e) => setText(e.target.value)} style={{ marginBottom: 10, fontSize: 13 }} />

      <label className="tfh-label" style={{ fontSize: 10 }}>Description</label>
      <textarea className="tfh-input" rows={2} placeholder="Details for this item (optional)" value={description} onChange={(e) => setDescription(e.target.value)} style={{ marginBottom: 10, resize: "vertical", fontSize: 12.5 }} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
        <div>
          <label className="tfh-label" style={{ fontSize: 10 }}>Start time</label>
          <input type="time" className="tfh-input" value={startTime} onChange={(e) => setStartTime(e.target.value)} style={{ fontSize: 12 }} />
        </div>
        <div>
          <label className="tfh-label" style={{ fontSize: 10 }}>End time</label>
          <input type="time" className="tfh-input" value={endTime} onChange={(e) => setEndTime(e.target.value)} style={{ fontSize: 12 }} />
        </div>
      </div>

      <label className="tfh-label" style={{ fontSize: 10 }}>Links</label>
      {links.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 6 }}>
          {links.map((l, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 7, padding: "4px 7px", borderRadius: 6, background: "var(--panel)" }}>
              <Link2 size={11} color="var(--text-faint)" />
              <span style={{ flex: 1, fontSize: 11.5, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.label}</span>
              <button type="button" onClick={() => removeLink(i)} className="tfh-btn tfh-btn-ghost" style={{ padding: 2 }} aria-label="Remove link"><X size={10} /></button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 5, marginBottom: 12 }}>
        <input value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)} placeholder="Label" className="tfh-input" style={{ fontSize: 11, flex: "0 0 36%" }} />
        <input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://…" className="tfh-input" style={{ fontSize: 11 }} />
        <button type="button" onClick={addLink} className="tfh-btn tfh-btn-ghost" style={{ padding: "3px 7px", flexShrink: 0 }} aria-label="Add link"><Plus size={11} /></button>
      </div>

      <label className="tfh-label" style={{ fontSize: 10 }}>Files</label>
      {files.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 6 }}>
          {files.map((f, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 7, padding: "4px 7px", borderRadius: 6, background: "var(--panel)" }}>
              <Paperclip size={11} color="var(--text-faint)" />
              <span style={{ flex: 1, fontSize: 11.5, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
              <button type="button" onClick={() => removeFile(i)} className="tfh-btn tfh-btn-ghost" style={{ padding: 2 }} aria-label="Remove file"><X size={10} /></button>
            </div>
          ))}
        </div>
      )}
      <input ref={fileInputRef} type="file" multiple style={{ display: "none" }} onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }} />
      <button type="button" onClick={() => fileInputRef.current?.click()} className="tfh-btn tfh-btn-ghost" style={{ fontSize: 10.5, padding: "3px 7px", marginBottom: fileError ? 6 : 14 }}>
        <Upload size={10} /> Add file
      </button>
      {fileError && <div style={{ fontSize: 10.5, color: "var(--pri-high)", marginBottom: 14 }}>{fileError}</div>}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", borderTop: "1px solid var(--line)", paddingTop: 12 }}>
        <button type="button" className="tfh-btn" onClick={onCancel}>Cancel</button>
        <button className="tfh-btn tfh-btn-accent" disabled={!text.trim()}><Plus size={13} /> Add subtask</button>
      </div>
    </form>
  );
};

const SubtaskRow = ({ subtask, canManage, canAttach, workspaceId, projectId, taskId, onToggle, onRemove, onUpdate }) => {
  const [expanded, setExpanded] = useState(false);
  const isSaved = subtask.id && !String(subtask.id).startsWith("local-");
  const hasTime = subtask.startTime || subtask.endTime;
  const pendingLinks = subtask.pendingLinks || [];
  const pendingFiles = subtask.pendingFiles || [];
  const hasExtras = (subtask.attachmentCount > 0) || (subtask.linkCount > 0) || subtask.description || pendingFiles.length > 0 || pendingLinks.length > 0;

  return (
    <div className="tfh-card" style={{ padding: "8px 10px", background: "var(--raised)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <MiniCheckbox checked={subtask.done} onClick={canManage ? () => onToggle(subtask.id) : undefined} disabled={!canManage} />
        <span style={{ flex: 1, minWidth: 0, fontSize: 13, textDecoration: subtask.done ? "line-through" : "none", color: subtask.done ? "var(--text-faint)" : "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{subtask.text}</span>
        {hasTime && (
          <span className="tfh-chip tfh-mono" style={{ background: "var(--accent-soft)", color: "var(--accent)", flexShrink: 0 }}>
            <Clock size={9} /> {subtask.startTime ? formatTimeLabel(subtask.startTime) : ""}{subtask.endTime ? ` – ${formatTimeLabel(subtask.endTime)}` : ""}
          </span>
        )}
        {subtask.attachmentCount > 0 && <span className="tfh-chip" style={{ flexShrink: 0 }}><Paperclip size={9} /> {subtask.attachmentCount}</span>}
        {subtask.linkCount > 0 && <span className="tfh-chip" style={{ flexShrink: 0 }}><Link2 size={9} /> {subtask.linkCount}</span>}
        {!isSaved && pendingFiles.length > 0 && <span className="tfh-chip" style={{ flexShrink: 0, background: "var(--accent-soft)", color: "var(--accent)" }}><Paperclip size={9} /> {pendingFiles.length} pending</span>}
        {!isSaved && pendingLinks.length > 0 && <span className="tfh-chip" style={{ flexShrink: 0, background: "var(--accent-soft)", color: "var(--accent)" }}><Link2 size={9} /> {pendingLinks.length} pending</span>}
        <button type="button" onClick={() => setExpanded((v) => !v)} className="tfh-btn tfh-btn-ghost" style={{ padding: 3, flexShrink: 0 }} aria-label="Expand">
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
        {canManage && <button type="button" onClick={() => onRemove(subtask.id)} className="tfh-btn tfh-btn-ghost" style={{ padding: 3, flexShrink: 0 }} aria-label="Remove subtask"><X size={13} color="var(--text-faint)" /></button>}
      </div>

      {expanded && (
        <div className="tfh-expand-in" style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div>
              <label className="tfh-label" style={{ fontSize: 10 }}>Start time</label>
              <input type="time" disabled={!canManage} value={subtask.startTime || ""} onChange={(e) => onUpdate(subtask.id, { startTime: e.target.value })} className="tfh-input" style={{ fontSize: 12 }} />
            </div>
            <div>
              <label className="tfh-label" style={{ fontSize: 10 }}>End time</label>
              <input type="time" disabled={!canManage} value={subtask.endTime || ""} onChange={(e) => onUpdate(subtask.id, { endTime: e.target.value })} className="tfh-input" style={{ fontSize: 12 }} />
            </div>
          </div>
          <div>
            <label className="tfh-label" style={{ fontSize: 10 }}>Description</label>
            <textarea disabled={!canManage} placeholder="Details for this item" value={subtask.description || ""} onChange={(e) => onUpdate(subtask.id, { description: e.target.value })} className="tfh-input" rows={2} style={{ fontSize: 12, resize: "vertical" }} />
          </div>
          {isSaved ? (
            <>
              <SubtaskAttachmentsMini workspaceId={workspaceId} projectId={projectId} taskId={taskId} subtaskId={subtask.id} canManage={canAttach} />
              <SubtaskLinksMini workspaceId={workspaceId} projectId={projectId} taskId={taskId} subtaskId={subtask.id} canManage={canAttach} />
            </>
          ) : (
            <>
              {(pendingFiles.length > 0 || pendingLinks.length > 0) ? (
                <>
                  {pendingFiles.length > 0 && (
                    <div>
                      <div className="tfh-label" style={{ fontSize: 10 }}>Files (will upload on save)</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {pendingFiles.map((f, i) => (
                          <div key={i} style={{ display: "flex", alignItems: "center", gap: 7, padding: "4px 7px", borderRadius: 6, background: "var(--panel)" }}>
                            <Paperclip size={11} color="var(--text-faint)" />
                            <span style={{ flex: 1, fontSize: 11.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.name}</span>
                            {canManage && <button type="button" onClick={() => onUpdate(subtask.id, { pendingFiles: pendingFiles.filter((_, idx) => idx !== i) })} className="tfh-btn tfh-btn-ghost" style={{ padding: 2 }} aria-label="Remove"><X size={10} /></button>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {pendingLinks.length > 0 && (
                    <div>
                      <div className="tfh-label" style={{ fontSize: 10 }}>Links (will save with the subtask)</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {pendingLinks.map((l, i) => (
                          <div key={i} style={{ display: "flex", alignItems: "center", gap: 7, padding: "4px 7px", borderRadius: 6, background: "var(--panel)" }}>
                            <Link2 size={11} color="var(--text-faint)" />
                            <span style={{ flex: 1, fontSize: 11.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.label}</span>
                            {canManage && <button type="button" onClick={() => onUpdate(subtask.id, { pendingLinks: pendingLinks.filter((_, idx) => idx !== i) })} className="tfh-btn tfh-btn-ghost" style={{ padding: 2 }} aria-label="Remove"><X size={10} /></button>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div style={{ fontSize: 11, color: "var(--text-faint)" }}>No files or links queued for this item yet.</div>
              )}
            </>
          )}
        </div>
      )}
      {!expanded && hasExtras && (
        <button type="button" onClick={() => setExpanded(true)} style={{ background: "none", border: "none", padding: 0, marginTop: 4, fontSize: 10.5, color: "var(--text-faint)" }}>
          {subtask.description ? "Has a description" : "Has details"} — click to view
        </button>
      )}
    </div>
  );
};

// Staging area for a brand-new task's own files/links, shown only while
// creating it (no task id exists yet to attach to directly). Mirrors the
// same stage-then-upload pattern already used for subtasks and milestones —
// uploaded automatically once the task is saved and has a real id.
const PendingFilesLinks = ({ draft, setDraft }) => {
  const [linkLabel, setLinkLabel] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [fileError, setFileError] = useState("");
  const fileInputRef = useRef(null);

  const addLink = (e) => {
    e.preventDefault();
    if (!linkUrl.trim()) return;
    setDraft({ ...draft, pendingLinks: [...draft.pendingLinks, { label: linkLabel.trim() || linkUrl.trim(), url: linkUrl.trim() }] });
    setLinkLabel(""); setLinkUrl("");
  };
  const removeLink = (i) => setDraft({ ...draft, pendingLinks: draft.pendingLinks.filter((_, idx) => idx !== i) });
  const handleFiles = (fileList) => {
    const { accepted, rejected } = validateFiles(fileList);
    if (accepted.length) setDraft({ ...draft, pendingFiles: [...draft.pendingFiles, ...accepted] });
    if (rejected.length) setFileError(`${rejected.join(", ")} — over the ${MAX_FILE_MB}MB limit, not added.`);
    else setFileError("");
  };
  const removeFile = (i) => setDraft({ ...draft, pendingFiles: draft.pendingFiles.filter((_, idx) => idx !== i) });

  return (
    <div className="tfh-card" style={{ padding: 16, marginBottom: 18 }}>
      <label className="tfh-label">Files</label>
      {draft.pendingFiles.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 6 }}>
          {draft.pendingFiles.map((f, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 7, padding: "5px 8px", borderRadius: 7, background: "var(--raised)" }}>
              <Paperclip size={12} color="var(--text-faint)" />
              <span style={{ flex: 1, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
              <button type="button" onClick={() => removeFile(i)} className="tfh-btn tfh-btn-ghost" style={{ padding: 3 }} aria-label="Remove file"><X size={11} /></button>
            </div>
          ))}
        </div>
      )}
      <input ref={fileInputRef} type="file" multiple style={{ display: "none" }} onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }} />
      <button type="button" onClick={() => fileInputRef.current?.click()} className="tfh-btn tfh-btn-ghost" style={{ fontSize: 11.5, padding: "4px 9px", marginBottom: 16 }}>
        <Upload size={11} /> Add file
      </button>
      {fileError && <div style={{ fontSize: 11, color: "var(--pri-high)", marginBottom: 14 }}>{fileError}</div>}

      <label className="tfh-label">Links</label>
      {draft.pendingLinks.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 6 }}>
          {draft.pendingLinks.map((l, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 7, padding: "5px 8px", borderRadius: 7, background: "var(--raised)" }}>
              <Link2 size={12} color="var(--text-faint)" />
              <span style={{ flex: 1, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.label}</span>
              <button type="button" onClick={() => removeLink(i)} className="tfh-btn tfh-btn-ghost" style={{ padding: 3 }} aria-label="Remove link"><X size={11} /></button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 6 }}>
        <input value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)} placeholder="Label" className="tfh-input" style={{ fontSize: 12, flex: "0 0 36%" }} />
        <input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://…" className="tfh-input" style={{ fontSize: 12 }} />
        <button type="button" onClick={addLink} className="tfh-btn tfh-btn-ghost" style={{ padding: "4px 9px", flexShrink: 0 }} aria-label="Add link"><Plus size={12} /></button>
      </div>
    </div>
  );
};

const TaskDialog = ({ draft, setDraft, users, projects, onClose, onSave, onDelete, saving, saveError, uploadPhase, isWorkspaceManager, workspaceId, currentUserId }) => {
  const [addingSubtask, setAddingSubtask] = useState(false);
  const titleRef = useRef(null);
  useEffect(() => { titleRef.current?.focus(); }, []);

  // canManage has to be computed per-task now, not passed in pre-decided —
  // Board shows tasks from every project at once, so "am I this project's
  // lead" has to check THIS task's own project (draft.projectId), not
  // whichever project happens to be selected in the sidebar.
  const taskProject = projects.find((p) => p.id === draft.projectId);
  const canManage = isWorkspaceManager || taskProject?.leadId === currentUserId;

  // Anyone can fill in every field while CREATING a brand-new task. Once a
  // task exists: a manager can edit/attach on any task; a plain member can
  // now fully edit and attach on a task assigned to THEM specifically — but
  // reassigning it to someone else stays manager-only even then (see
  // canChangeAssignee below), and a task NOT assigned to you stays view +
  // comment only, matching what was asked to stay unchanged.
  const isOwnTask = draft.id && draft.assigneeId === currentUserId;
  const canEditFields = !draft.id || canManage || isOwnTask;
  const canAttach = canManage || isOwnTask;
  const canChangeAssignee = !draft.id || canManage;

  const addSubtask = (fields) => {
    setDraft({ ...draft, subtasks: [...draft.subtasks, { id: `local-${Date.now()}`, done: false, attachmentCount: 0, linkCount: 0, ...fields }] });
    setAddingSubtask(false);
  };
  const toggleSubtask = (id) => setDraft({ ...draft, subtasks: draft.subtasks.map((s) => (s.id === id ? { ...s, done: !s.done } : s)) });
  const removeSubtask = (id) => setDraft({ ...draft, subtasks: draft.subtasks.filter((s) => s.id !== id) });
  const updateSubtask = (id, patch) => setDraft({ ...draft, subtasks: draft.subtasks.map((s) => (s.id === id ? { ...s, ...patch } : s)) });

  return (
    <div className="tfh-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="tfh-card tfh-modal-card" style={{ width: "100%", maxWidth: 560, maxHeight: "88vh", overflowY: "auto", padding: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <span className="tfh-display" style={{ fontSize: 19, fontWeight: 600 }}>{draft.id ? "Edit task" : "New task"}</span>
          <button className="tfh-btn tfh-btn-ghost" style={{ padding: 6 }} onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>

        {!canManage && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-dim)", background: "var(--raised)", padding: "9px 12px", borderRadius: 10, marginBottom: 14 }}>
            <Lock size={13} /> View only — you can comment below, but only your admin, team lead, or this project's lead can edit or move this task.
          </div>
        )}

        <label className="tfh-label" htmlFor="tfh-title">Title</label>
        <input id="tfh-title" ref={titleRef} disabled={!canEditFields} className="tfh-input" placeholder="What needs doing?" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} style={{ marginBottom: 14, opacity: canEditFields ? 1 : 0.7 }} />

        <label className="tfh-label" htmlFor="tfh-desc">Description</label>
        <textarea id="tfh-desc" disabled={!canEditFields} className="tfh-input" rows={3} placeholder="Add context so anyone on the team can pick this up" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} style={{ marginBottom: 18, resize: "vertical", opacity: canEditFields ? 1 : 0.7 }} />

        <label className="tfh-label">Subtasks <span style={{ textTransform: "none", fontWeight: 400, color: "var(--text-faint)" }}>— mini tasks of their own, each with a time, description, files, and links</span></label>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
          {draft.subtasks.map((s) => (
            <SubtaskRow
              key={s.id} subtask={s} canManage={canEditFields} canAttach={canAttach}
              workspaceId={workspaceId} projectId={draft.projectId} taskId={draft.id}
              onToggle={toggleSubtask} onRemove={removeSubtask} onUpdate={updateSubtask}
            />
          ))}
        </div>
        {canEditFields && (
          <div style={{ marginBottom: 20 }}>
            {addingSubtask ? (
              <NewSubtaskForm onAdd={addSubtask} onCancel={() => setAddingSubtask(false)} />
            ) : (
              <button className="tfh-btn tfh-btn-accent" onClick={() => setAddingSubtask(true)}><Plus size={14} /> Add subtask</button>
            )}
          </div>
        )}

        <div style={{ marginBottom: 14 }}>
          <label className="tfh-label">Project</label>
          <select
            disabled={!!draft.id} className="tfh-input" value={draft.projectId}
            onChange={(e) => setDraft({ ...draft, projectId: e.target.value })}
            style={{ opacity: draft.id ? 0.7 : 1 }}
          >
            <option value="" disabled>Choose a project…</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {draft.id && <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4 }}>A task's project is set when it's created and can't be changed afterward.</div>}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
          <div>
            <label className="tfh-label">Stage</label>
            <select disabled={!canEditFields} className="tfh-input" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })} style={{ opacity: canEditFields ? 1 : 0.7 }}>
              {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className="tfh-label">Priority</label>
            <select disabled={!canEditFields} className="tfh-input" value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value })} style={{ opacity: canEditFields ? 1 : 0.7 }}>
              {Object.entries(PRIORITIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div>
            <label className="tfh-label">Assignee</label>
            <select disabled={!canChangeAssignee} className="tfh-input" value={draft.assigneeId} onChange={(e) => setDraft({ ...draft, assigneeId: e.target.value })} style={{ opacity: canChangeAssignee ? 1 : 0.7 }}>
              {users.map((m) => <option key={m.id} value={m.id}>{m.name}{m.role === "admin" ? " (Admin)" : m.role === "lead" ? " (Lead)" : ""}</option>)}
            </select>
          </div>
          <div>
            <label className="tfh-label">Due date</label>
            <input type="date" disabled={!canEditFields} className="tfh-input" value={draft.due} onChange={(e) => setDraft({ ...draft, due: e.target.value })} style={{ opacity: canEditFields ? 1 : 0.7 }} />
          </div>
          <div>
            <label className="tfh-label">Time <span style={{ textTransform: "none", fontWeight: 400, color: "var(--text-faint)" }}>(optional — for meetings/appointments)</span></label>
            <input type="time" disabled={!canEditFields} className="tfh-input" value={draft.dueTime || ""} onChange={(e) => setDraft({ ...draft, dueTime: e.target.value })} style={{ opacity: canEditFields ? 1 : 0.7 }} />
          </div>
        </div>

        {!draft.id && <PendingFilesLinks draft={draft} setDraft={setDraft} />}

        {draft.id && (
          <Attachments workspaceId={workspaceId} projectId={draft.projectId} taskId={draft.id} canAttach={canAttach} />
        )}

        {draft.id && (
          <Links workspaceId={workspaceId} projectId={draft.projectId} taskId={draft.id} canAttach={canAttach} />
        )}

        {draft.id && (
          <Comments workspaceId={workspaceId} projectId={draft.projectId} taskId={draft.id} canComment={true} currentUserId={currentUserId} />
        )}

        {saveError && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5, color: "var(--pri-high)", background: "var(--raised)", border: "1px solid var(--pri-high)", padding: "10px 12px", borderRadius: 10, marginTop: 14, lineHeight: 1.5 }}>
            <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} /> {saveError}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--line)", paddingTop: 16, marginTop: saveError ? 0 : undefined }}>
          {draft.id && canManage ? <DeleteButton onConfirm={() => onDelete(draft.id)} /> : <span />}
          <div style={{ display: "flex", gap: 8 }}>
            {canEditFields ? (
              <>
                <button className="tfh-btn" onClick={onClose} disabled={saving}>Cancel</button>
                <button className="tfh-btn tfh-btn-accent" disabled={!draft.title.trim() || saving} onClick={onSave}>
                  {uploadPhase ? "Uploading files…" : saving ? "Saving…" : draft.id ? "Save changes" : "Create task"}
                </button>
              </>
            ) : (
              <button className="tfh-btn tfh-btn-accent" onClick={onClose}>Close</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Bulk add — paste a day's list of activities at once                   */
/* ------------------------------------------------------------------ */
// Matches a leading "Name:" or "Name -" on a line against a workspace member,
// by full name, first name, or initials — so pasting straight from a log
// grouped by person (like "Leo: fix the bug") assigns it to the right person
// without needing a dropdown per line.
function matchMemberPrefix(line, members) {
  const m = line.match(/^([A-Za-z][A-Za-z.\s]{0,30}?)\s*[:\-–—]\s+(.+)$/);
  if (!m) return null;
  const rawName = m[1].trim().toLowerCase();
  const rest = m[2].trim();
  if (!rest) return null;

  const found = members.find((mem) => {
    const full = mem.name.toLowerCase();
    const first = mem.name.split(" ")[0].toLowerCase();
    const initials = mem.initials.toLowerCase();
    return full === rawName || first === rawName || initials === rawName;
  });
  return found ? { member: found, rest } : null;
}

// Parses the pasted block into one task per non-indented line. A line
// indented under it (spaces, a tab, or a leading "-"/"*") becomes a subtask
// of the task directly above it — matching how the source activity logs
// nest detail bullets under a main line.
function parseBulkText(text, members, defaultAssigneeId) {
  const rawLines = text.split("\n");
  const tasks = [];

  for (const raw of rawLines) {
    if (!raw.trim()) continue;
    const isIndented = /^\s/.test(raw) || /^\s*[-*]\s+/.test(raw.trimStart()) && /^\s/.test(raw);
    const trimmed = raw.trim().replace(/^[-*]\s+/, "");

    if (isIndented && tasks.length > 0) {
      tasks[tasks.length - 1].subtasks.push(trimmed);
      continue;
    }

    const prefixMatch = matchMemberPrefix(trimmed, members);
    if (prefixMatch) {
      tasks.push({ title: prefixMatch.rest, assigneeId: prefixMatch.member.id, assigneeName: prefixMatch.member.name, subtasks: [] });
    } else {
      const fallback = members.find((m) => m.id === defaultAssigneeId);
      tasks.push({ title: trimmed, assigneeId: defaultAssigneeId, assigneeName: fallback?.name || "—", subtasks: [] });
    }
  }
  return tasks;
}

const BulkAddModal = ({ users, currentUserId, onClose, onSubmit }) => {
  const [assigneeId, setAssigneeId] = useState(currentUserId || users[0]?.id || "");
  const [due, setDue] = useState(new Date().toISOString().slice(0, 10));
  const [priority, setPriority] = useState("medium");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const parsed = parseBulkText(text, users, assigneeId);

  const submit = async (e) => {
    e.preventDefault();
    if (parsed.length === 0) return;
    setBusy(true);
    setError("");
    try {
      await onSubmit({ tasks: parsed.map((t) => ({ title: t.title, assigneeId: t.assigneeId, subtasks: t.subtasks })), due, priority });
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tfh-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="tfh-card tfh-modal-card" style={{ width: "100%", maxWidth: 620, maxHeight: "88vh", overflowY: "auto", padding: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <span className="tfh-display" style={{ fontSize: 19, fontWeight: 600 }}>Add a day's tasks at once</span>
          <button className="tfh-btn tfh-btn-ghost" style={{ padding: 6 }} onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginBottom: 18, lineHeight: 1.5 }}>
          Paste one line per task. Start a line with a name to assign it to that
          person — e.g. <span className="tfh-mono">Leo: fix the Safari bug</span> — otherwise it
          goes to whoever's picked below. Indent a line underneath a task to make
          it a subtask instead of a new task. A leading time like{" "}
          <span className="tfh-mono">9:00 AM</span> is pulled into its own field automatically.
        </div>

        <form onSubmit={submit}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
            <div>
              <label className="tfh-label">Default assignee <span style={{ textTransform: "none", fontWeight: 400 }}>(for lines with no name)</span></label>
              <select className="tfh-input" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
                {users.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div>
              <label className="tfh-label">Due date</label>
              <input type="date" className="tfh-input" value={due} onChange={(e) => setDue(e.target.value)} />
            </div>
            <div>
              <label className="tfh-label">Priority</label>
              <select className="tfh-input" value={priority} onChange={(e) => setPriority(e.target.value)}>
                {Object.entries(PRIORITIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
          </div>

          <label className="tfh-label">Tasks</label>
          <textarea
            className="tfh-input" rows={7} style={{ resize: "vertical", fontFamily: "IBM Plex Mono, monospace", fontSize: 12.5 }}
            placeholder={"Leo: 9:00 AM - Meeting with Director\n  Prepare slides\n  Confirm attendees\nSena: Migrate auth to new provider\nDraft the press release"}
            value={text} onChange={(e) => setText(e.target.value)}
          />

          {parsed.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, margin: "10px 0 6px", maxHeight: 180, overflowY: "auto" }}>
              {parsed.map((t, i) => {
                const member = users.find((m) => m.id === t.assigneeId);
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 9px", borderRadius: 8, background: "var(--raised)" }}>
                    <Avatar member={member} size={20} />
                    <span style={{ fontSize: 12.5, flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.title}</span>
                    {t.subtasks.length > 0 && (
                      <span className="tfh-chip tfh-mono" style={{ background: "var(--panel)", color: "var(--text-faint)", flexShrink: 0 }}>{t.subtasks.length} sub</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <div style={{ fontSize: 11.5, color: "var(--text-faint)", margin: "6px 0 18px" }}>
            {parsed.length} task{parsed.length === 1 ? "" : "s"} will be created, all due on the date above.
          </div>

          {error && <div style={{ fontSize: 12.5, color: "var(--pri-high)", marginBottom: 14 }}>{error}</div>}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, borderTop: "1px solid var(--line)", paddingTop: 16 }}>
            <button type="button" className="tfh-btn" onClick={onClose}>Cancel</button>
            <button className="tfh-btn tfh-btn-accent" disabled={busy || parsed.length === 0}>
              {busy ? "Creating…" : `Create ${parsed.length || ""} task${parsed.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Flow meter                                                           */
/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/* Notification bell                                                    */
/* ------------------------------------------------------------------ */
const NotificationBell = ({ notifications, onOpenTask, onMarkRead, onMarkAll, permission, onRequestPermission }) => {
  const [open, setOpen] = useState(false);
  const unread = notifications.filter((n) => !n.read).length;
  const ref = useRef(null);
  const prevUnread = useRef(unread);
  const [ringing, setRinging] = useState(false);

  useEffect(() => {
    if (unread > prevUnread.current) {
      setRinging(true);
      const t = setTimeout(() => setRinging(false), 600);
      prevUnread.current = unread;
      return () => clearTimeout(t);
    }
    prevUnread.current = unread;
  }, [unread]);

  useEffect(() => {
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div style={{ position: "relative" }} ref={ref}>
      <button className={`tfh-btn tfh-btn-ghost ${ringing ? "tfh-bell-ring" : ""}`} style={{ padding: 8, position: "relative" }} onClick={() => setOpen((o) => !o)} aria-label="Notifications">
        <Bell size={17} />
        {unread > 0 && <span className="tfh-badge-dot" />}
      </button>
      {open && (
        <div className="tfh-card tfh-fade-in" style={{ position: "absolute", right: 0, top: 42, width: 340, maxHeight: 420, overflowY: "auto", zIndex: 30, padding: 10 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 6px 10px" }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>Notifications</span>
            <button className="tfh-btn tfh-btn-ghost" style={{ fontSize: 11.5, padding: "4px 8px" }} onClick={onMarkAll}>Mark all read</button>
          </div>
          {permission !== "granted" && (
            <button className="tfh-btn" style={{ width: "100%", marginBottom: 8, fontSize: 12 }} onClick={onRequestPermission}>
              Enable desktop alerts
            </button>
          )}
          {notifications.length === 0 && (
            <div style={{ fontSize: 12.5, color: "var(--text-faint)", padding: "16px 8px", textAlign: "center" }}>Nothing yet — you'll see it here the moment it happens.</div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {notifications.map((n, i) => (
              <button
                key={n.id}
                className="tfh-stagger"
                onClick={() => { onMarkRead(n.id); if (n.taskId) onOpenTask(n.taskId); setOpen(false); }}
                style={{ textAlign: "left", background: n.read ? "transparent" : "var(--accent-soft)", border: "1px solid var(--line)", borderRadius: 10, padding: 10, display: "flex", flexDirection: "column", gap: 3 }}
              >
                <span style={{ fontSize: 11, color: "var(--accent)", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.03 }}>{NOTIF_LABEL[n.type] || n.type}</span>
                <span style={{ fontSize: 12.5, color: "var(--text)" }}>{n.message}</span>
                <span style={{ fontSize: 11, color: "var(--text-faint)" }}>{timeAgo(n.createdAt)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Dashboard view                                                        */
/* ------------------------------------------------------------------ */
const StatCard = ({ label, value, sub, accent, onClick }) => {
  const [pop, setPop] = useState(false);
  const prevValue = useRef(value);

  useEffect(() => {
    if (prevValue.current !== value) {
      setPop(true);
      const t = setTimeout(() => setPop(false), 320);
      prevValue.current = value;
      return () => clearTimeout(t);
    }
  }, [value]);

  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={`tfh-card tfh-fade-in ${onClick ? "tfh-card-interactive" : ""}`}
      style={{ padding: 18, flex: 1, minWidth: 140, textAlign: "left", border: onClick ? undefined : undefined }}
    >
      <div className="tfh-label" style={{ marginBottom: 10 }}>{label}</div>
      <div className={`tfh-display ${pop ? "tfh-number-pop" : ""}`} style={{ fontSize: 30, fontWeight: 600, color: accent || "var(--text)" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 4 }}>{sub}</div>}
    </Tag>
  );
};

const TaskListMini = ({ title, items, users, onOpen, emptyText, showAssignee }) => (
  <div className="tfh-card" style={{ padding: 20 }}>
    <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14 }}>{title}</div>
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {items.map((t) => {
        const meta = dueMeta(t.due, t.status);
        const a = memberById(users, t.assigneeId);
        return (
          <button key={t.id} onClick={() => onOpen(t)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 8px", borderRadius: 10, background: "transparent", border: "none", color: "var(--text)", textAlign: "left" }}>
            <span style={{ width: 7, height: 7, borderRadius: 999, background: STAGES.find((s) => s.id === t.status).color, flexShrink: 0 }} />
            {t.dueTime && <span className="tfh-mono" style={{ fontSize: 11.5, color: "var(--accent)", flexShrink: 0 }}>{formatTimeLabel(t.dueTime)}</span>}
            <span style={{ fontSize: 13.5, flex: 1, textDecoration: t.status === "done" ? "line-through" : "none", color: t.status === "done" ? "var(--text-dim)" : "var(--text)" }}>{t.title}</span>
            <PriorityChip level={t.priority} />
            <span style={{ fontSize: 12, color: meta.tone, minWidth: 92, textAlign: "right" }}>{meta.label}</span>
            {showAssignee && <Avatar member={a} size={22} />}
          </button>
        );
      })}
      {items.length === 0 && <div style={{ fontSize: 12.5, color: "var(--text-faint)" }}>{emptyText}</div>}
    </div>
  </div>
);

// Merges tasks due today with today's activity-log text blocks into one
// time-sorted agenda. Timed items (has a specific clock time) come first in
// order; untimed items follow. Only tasks can be "upcoming" — you can't log
// activity for a day that hasn't happened yet, so that concept doesn't
// apply to the activity-log side of this merge.
const mergeAgenda = (tasksToday, activityBlocksToday) => {
  const items = [
    ...tasksToday.map((t) => ({ time: t.dueTime || null, label: t.title, kind: "task", task: t })),
    ...activityBlocksToday.filter((b) => b.type === "text" && b.text?.trim()).map((b) => ({ time: b.time || null, label: b.text, kind: "activity" })),
  ];
  const timed = items.filter((i) => i.time).sort((a, b) => a.time.localeCompare(b.time));
  const untimed = items.filter((i) => !i.time);
  return [...timed, ...untimed];
};

const shortDate = (dateStr) => new Date(dateStr + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });

// Recently completed tasks + past (non-today) logged activity, newest
// first — the "Past" tab's content. Activity log entries here come from a
// wider date-range fetch, not the today-only one.
const buildPastItems = (pastTasks, pastLogEntries) => {
  const items = [
    ...pastTasks.map((t) => ({ dateStr: t.due, dateLabel: shortDate(t.due), label: t.title, kind: "task", task: t })),
    ...pastLogEntries.flatMap((l) =>
      (l.content || [])
        .filter((b) => b.type === "text" && b.text?.trim())
        .map((b) => ({ dateStr: l.entryDate, dateLabel: shortDate(l.entryDate), label: b.text, kind: "activity" }))
    ),
  ];
  return items.sort((a, b) => b.dateStr.localeCompare(a.dateStr));
};

const buildUpcomingItems = (upcomingTasks) =>
  upcomingTasks.map((t) => ({ dateStr: t.due, dateLabel: shortDate(t.due), label: t.title, kind: "task", task: t }));

const AgendaRow = ({ item, onOpen }) => (
  <div
    onClick={item.kind === "task" ? () => onOpen(item.task) : undefined}
    style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "7px 8px", borderRadius: 8, cursor: item.kind === "task" ? "pointer" : "default" }}
  >
    <span className="tfh-mono" style={{ fontSize: 11, color: item.time ? "var(--accent)" : item.dateLabel ? "var(--text-dim)" : "var(--text-faint)", minWidth: item.dateLabel ? 54 : 58, flexShrink: 0, marginTop: 1 }}>
      {item.time ? formatTimeLabel(item.time) : item.dateLabel || "Anytime"}
    </span>
    <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span style={{ fontSize: 12.5, color: "var(--text)", textDecoration: item.kind === "task" && item.task.status === "done" ? "line-through" : "none" }}>{item.label}</span>
      {item.kind === "task" && <PriorityChip level={item.task.priority} />}
      {item.kind === "activity" && <span className="tfh-chip" style={{ fontSize: 9.5, background: "var(--raised)", color: "var(--text-faint)" }}>Logged</span>}
    </div>
  </div>
);

const AgendaCard = ({ title, items, onOpen, emptyText }) => (
  <div className="tfh-card" style={{ padding: 18 }}>
    <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>{title}</div>
    {items.length === 0 ? (
      <div style={{ fontSize: 12, color: "var(--text-faint)", padding: "4px 8px" }}>{emptyText}</div>
    ) : (
      <div style={{ display: "flex", flexDirection: "column" }}>
        {items.map((item, i) => <AgendaRow key={i} item={item} onOpen={onOpen} />)}
      </div>
    )}
  </div>
);

// Collapsed by default (name + a compact count), expandable on click — the
// fix for "looks packed" once there are several team members: previously
// every single person's full agenda rendered at once, stacking up fast.
const TeamMemberAgenda = ({ member, items, onOpen, emptyText }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="tfh-card" style={{ padding: expanded ? 16 : "10px 14px" }}>
      <button
        onClick={() => setExpanded((e) => !e)}
        style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", background: "none", border: "none", cursor: "pointer", padding: 0 }}
      >
        <Avatar member={member} size={22} />
        <span style={{ fontSize: 12.5, fontWeight: 700, flex: 1, textAlign: "left" }}>{member.name}</span>
        <span style={{ fontSize: 11, color: "var(--text-faint)" }}>{items.length > 0 ? `${items.length} item${items.length === 1 ? "" : "s"}` : ""}</span>
        {expanded ? <ChevronUp size={14} color="var(--text-faint)" /> : <ChevronDown size={14} color="var(--text-faint)" />}
      </button>
      {expanded && (
        <div className="tfh-expand-in" style={{ marginTop: 10 }}>
          {items.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {items.map((item, i) => <AgendaRow key={i} item={item} onOpen={onOpen} />)}
            </div>
          ) : (
            <div style={{ fontSize: 11.5, color: "var(--text-faint)", padding: "0 8px" }}>{emptyText}</div>
          )}
        </div>
      )}
    </div>
  );
};


const TEAM_TABS = [
  { id: "past", label: "Past" },
  { id: "today", label: "Today" },
  { id: "upcoming", label: "Upcoming" },
];

const DashboardView = ({ workspaceId, tasks, users, currentUser, onOpen, onOpenFiltered, hasProject, onCreateProject }) => {
  const [newProjectName, setNewProjectName] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const [myLogs, setMyLogs] = useState([]);
  const [teamLogs, setTeamLogs] = useState([]); // wide range: last 30 days through today
  const [logsLoading, setLogsLoading] = useState(true);
  const [teamTab, setTeamTab] = useState("today");

  useEffect(() => {
    let cancelled = false;
    setLogsLoading(true);
    const todayStr = new Date().toISOString().slice(0, 10);
    const rangeStart = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    Promise.all([api.getMyActivityLogs(workspaceId), api.getTeamActivityLogs(workspaceId, rangeStart, todayStr)])
      .then(([mine, team]) => {
        if (cancelled) return;
        setMyLogs(mine.logs);
        setTeamLogs(team.logs);
      })
      .finally(() => { if (!cancelled) setLogsLoading(false); });
    return () => { cancelled = true; };
  }, [workspaceId]);

  const submitNewProject = async (e) => {
    e.preventDefault();
    if (!newProjectName.trim()) return;
    setCreatingProject(true);
    try {
      await onCreateProject(newProjectName.trim());
      setNewProjectName("");
    } finally {
      setCreatingProject(false);
    }
  };

  const todayStr = new Date().toISOString().slice(0, 10);
  const doneCount = tasks.filter((t) => t.status === "done").length;
  const activeCount = tasks.filter((t) => t.status === "todo").length;
  const overdue = tasks.filter((t) => t.status !== "done" && dueMeta(t.due, t.status).label.includes("overdue"));

  const myTasksToday = tasks.filter((t) => t.assigneeId === currentUser?.id && t.due === todayStr);
  const myUpcoming = [...tasks]
    .filter((t) => t.assigneeId === currentUser?.id && t.status !== "done" && t.due && t.due > todayStr)
    .sort((a, b) => new Date(a.due) - new Date(b.due))
    .slice(0, 6);
  const myTodayEntry = myLogs.find((l) => l.entryDate === todayStr);
  const myAgenda = mergeAgenda(myTasksToday, myTodayEntry?.content || []);

  const isManager = currentUser?.role === "admin" || currentUser?.role === "lead";

  const mineColumn = (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, flex: "1 1 45%", minWidth: 0 }}>
      <AgendaCard title="My today's activities" items={myAgenda} onOpen={onOpen} emptyText="Nothing scheduled or logged for today yet." />
      <div className="tfh-card" style={{ padding: 18 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>Upcoming works</div>
        {myUpcoming.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--text-faint)", padding: "4px 8px" }}>Nothing upcoming.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {myUpcoming.map((t) => (
              <div key={t.id} onClick={() => onOpen(t)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 8px", borderRadius: 8, cursor: "pointer" }}>
                <span className="tfh-mono" style={{ fontSize: 11, color: "var(--text-faint)", minWidth: 78, flexShrink: 0 }}>{shortDate(t.due)}</span>
                <span style={{ fontSize: 12.5, flex: 1 }}>{t.title}</span>
                <PriorityChip level={t.priority} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Totals sit under "mine" specifically now, not centered above both
          columns — a 2x2 grid since this column is narrower than a
          full-width row would need. */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <StatCard label="Total tasks" value={tasks.length} sub="across all stages" onClick={() => onOpenFiltered("all")} />
        <StatCard label="Active" value={activeCount} sub="not yet completed" accent="var(--stage-progress)" onClick={() => onOpenFiltered("active")} />
        <StatCard label="Shipped" value={doneCount} sub="marked done" accent="var(--stage-done)" onClick={() => onOpenFiltered("shipped")} />
        <StatCard label="Overdue" value={overdue.length} sub={overdue.length ? "needs attention" : "all clear"} accent={overdue.length ? "var(--pri-high)" : "var(--stage-done)"} onClick={() => onOpenFiltered("overdue")} />
      </div>
    </div>
  );

  // Whichever tab is active decides what each team member's block shows —
  // same three concepts as the "All projects" style selector, applied to
  // the team's activity instead: what's already happened, what's happening
  // today, and what's coming up. Tasks and activity-log entries are merged
  // together in every tab, not shown as two separate lists.
  const teamColumn = (
    <div style={{ flex: "1 1 53%", minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>Team activities</span>
        <div style={{ display: "flex", gap: 4, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 9, padding: 3 }}>
          {TEAM_TABS.map((t) => (
            <button
              key={t.id} onClick={() => setTeamTab(t.id)}
              className="tfh-btn tfh-btn-ghost"
              style={{ fontSize: 11.5, padding: "4px 10px", background: teamTab === t.id ? "var(--accent-soft)" : "transparent", color: teamTab === t.id ? "var(--accent)" : "var(--text-dim)" }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {users.filter((u) => u.id !== currentUser?.id).map((u) => {
        let items = [];
        let emptyText = "Nothing here.";
        if (teamTab === "today") {
          const theirTasksToday = tasks.filter((t) => t.assigneeId === u.id && t.due === todayStr);
          const theirEntry = teamLogs.find((l) => l.userId === u.id && l.entryDate === todayStr);
          items = mergeAgenda(theirTasksToday, theirEntry?.content || []);
          emptyText = "Nothing today.";
        } else if (teamTab === "upcoming") {
          const theirUpcoming = [...tasks]
            .filter((t) => t.assigneeId === u.id && t.status !== "done" && t.due && t.due > todayStr)
            .sort((a, b) => new Date(a.due) - new Date(b.due));
          items = buildUpcomingItems(theirUpcoming);
          emptyText = "Nothing upcoming.";
        } else {
          const theirPastTasks = tasks
            .filter((t) => t.assigneeId === u.id && t.status === "done" && t.due && t.due < todayStr)
            .sort((a, b) => new Date(b.due) - new Date(a.due))
            .slice(0, 8);
          const theirPastLogs = teamLogs.filter((l) => l.userId === u.id && l.entryDate < todayStr);
          items = buildPastItems(theirPastTasks, theirPastLogs).slice(0, 10);
          emptyText = "Nothing in the past 30 days.";
        }
        if (items.length === 0 && logsLoading) return null; // avoid a flash of empty state while still loading
        return <TeamMemberAgenda key={u.id} member={u} items={items} onOpen={onOpen} emptyText={emptyText} />;
      })}
      {!logsLoading && users.filter((u) => u.id !== currentUser?.id).length === 0 && (
        <div className="tfh-card" style={{ padding: 18, textAlign: "center" }}>
          <div style={{ fontSize: 12, color: "var(--text-faint)" }}>No other team members yet.</div>
        </div>
      )}
    </div>
  );

  return (
    <div className="tfh-fade-in" style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <div>
        <div className="tfh-display" style={{ fontSize: 26, fontWeight: 600, marginBottom: 4 }}>Dashboard</div>
        <div style={{ fontSize: 13.5, color: "var(--text-dim)" }}>{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</div>
      </div>

      {!hasProject && (
        <div className="tfh-card" style={{ padding: 20, borderColor: "var(--accent)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <FolderKanban size={16} color="var(--accent)" />
            <span style={{ fontSize: 13.5, fontWeight: 700 }}>No project yet</span>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginBottom: isManager ? 14 : 0, lineHeight: 1.5 }}>
            {isManager
              ? "This workspace doesn't have a project yet — create one to start adding tasks. Everything below will fill in once you do."
              : "This workspace doesn't have a project yet. Check back once your admin or lead sets one up."}
          </div>
          {isManager && (
            <form onSubmit={submitNewProject} style={{ display: "flex", gap: 8, maxWidth: 380 }}>
              <input className="tfh-input" placeholder="Name your first project" value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} />
              <button className="tfh-btn tfh-btn-accent" disabled={creatingProject || !newProjectName.trim()} style={{ flexShrink: 0 }}>
                <Plus size={14} /> {creatingProject ? "Creating…" : "Create"}
              </button>
            </form>
          )}
        </div>
      )}

      {/* Mine on the left (with totals nested underneath it), team on the
          right — reverses on mobile so mine reads first, matching the
          same top-to-bottom order as the desktop left-to-right layout. */}
      <div className="tfh-dashboard-columns">
        {mineColumn}
        {teamColumn}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Board view                                                            */
/* ------------------------------------------------------------------ */
// Compact, inline "create a project" control — sits right next to the
// project filter on the Board, since that's the one remaining place "All
// projects" lives as a concept once the sidebar's own project list was
// removed. Toggle button reveals a small form in place, no separate modal.
const NewProjectButton = ({ onCreateProject }) => {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [deadline, setDeadline] = useState("");
  const [creating, setCreating] = useState(false);

  const close = () => { setOpen(false); setName(""); setDescription(""); setDeadline(""); };

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      await onCreateProject(name.trim(), description.trim(), deadline || null);
      close();
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <button className="tfh-btn tfh-btn-ghost" onClick={() => setOpen(true)} style={{ width: "100%", justifyContent: "flex-start" }}>
        <Plus size={14} /> New project
      </button>

      {open && (
        <div className="tfh-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
          <form onSubmit={submit} className="tfh-card tfh-modal-card" style={{ width: "100%", maxWidth: 420, padding: 22 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <span className="tfh-display" style={{ fontSize: 19, fontWeight: 600 }}>New project</span>
              <button type="button" className="tfh-btn tfh-btn-ghost" style={{ padding: 6 }} onClick={close} aria-label="Close"><X size={16} /></button>
            </div>

            <label className="tfh-label" htmlFor="np-name">Project name</label>
            <input
              id="np-name" autoFocus className="tfh-input" style={{ marginBottom: 14 }} placeholder="e.g. Q4 Export Readiness"
              value={name} onChange={(e) => setName(e.target.value)}
            />

            <label className="tfh-label" htmlFor="np-desc">Description <span style={{ textTransform: "none", fontWeight: 400, color: "var(--text-faint)" }}>(optional)</span></label>
            <textarea
              id="np-desc" className="tfh-input" rows={3} style={{ resize: "vertical", marginBottom: 14 }} placeholder="What's this project about?"
              value={description} onChange={(e) => setDescription(e.target.value)}
            />

            <label className="tfh-label" htmlFor="np-deadline">Deadline <span style={{ textTransform: "none", fontWeight: 400, color: "var(--text-faint)" }}>(optional)</span></label>
            <input id="np-deadline" type="date" className="tfh-input" style={{ marginBottom: 20 }} value={deadline} onChange={(e) => setDeadline(e.target.value)} />

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, borderTop: "1px solid var(--line)", paddingTop: 16 }}>
              <button type="button" className="tfh-btn" onClick={close} disabled={creating}>Cancel</button>
              <button className="tfh-btn tfh-btn-accent" disabled={creating || !name.trim()}>{creating ? "Creating…" : "Create project"}</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
};

const BoardView = ({ tasks, users, projects, onOpen, onComplete, onReopen, onAdd, onBulkAdd, onCreateProject, search, setSearch, priorityFilter, setPriorityFilter, assigneeFilter, setAssigneeFilter, statusFilter, setStatusFilter, projectFilter, setProjectFilter, canManage, currentUserId }) => {
  const filtered = tasks
    .filter((t) => {
      if (search && !t.title.toLowerCase().includes(search.toLowerCase())) return false;
      if (priorityFilter !== "all" && t.priority !== priorityFilter) return false;
      if (assigneeFilter !== "all" && t.assigneeId !== assigneeFilter) return false;
      if (projectFilter !== "all" && t.projectId !== projectFilter) return false;
      if (statusFilter === "active" && t.status !== "todo") return false;
      if (statusFilter === "shipped" && t.status !== "done") return false;
      if (statusFilter === "overdue" && !(t.status !== "done" && dueMeta(t.due, t.status).label.includes("overdue"))) return false;
      return true;
    })
    .sort((a, b) => `${a.due || "9999"} ${a.dueTime || "99:99"}`.localeCompare(`${b.due || "9999"} ${b.dueTime || "99:99"}`));

  const STATUS_QUICK_FILTERS = [
    { id: "all", label: "All" },
    { id: "active", label: "Active" },
    { id: "shipped", label: "Shipped" },
    { id: "overdue", label: "Overdue" },
  ];

  // Once you've filtered down to a single project, tagging every card with
  // that same project again is just noise — the badge earns its place only
  // when the board is showing more than one project at a time.
  const showProject = projectFilter === "all";
  const hasProjects = projects.length > 0;

  return (
    <div className="tfh-fade-in" style={{ display: "flex", flexDirection: "column", gap: 16, height: "100%" }}>
      {statusFilter !== "all" && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--accent)", background: "var(--accent-soft)", padding: "8px 12px", borderRadius: 10, width: "fit-content" }}>
          Showing: {STATUS_QUICK_FILTERS.find((f) => f.id === statusFilter)?.label}
          <button onClick={() => setStatusFilter("all")} className="tfh-btn tfh-btn-ghost" style={{ padding: 2 }} aria-label="Clear filter"><X size={12} /></button>
        </div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <div style={{ position: "relative", flex: "1 1 220px", maxWidth: 320 }}>
          <Search size={14} color="var(--text-faint)" style={{ position: "absolute", left: 11, top: 10 }} />
          <input className="tfh-input" style={{ paddingLeft: 32 }} placeholder="Search tasks" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="tfh-input" style={{ width: "auto" }} value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
          <option value="all">All projects</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {canManage && <NewProjectButton onCreateProject={onCreateProject} />}
        <select className="tfh-input" style={{ width: "auto" }} value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
          <option value="all">All priorities</option>
          {Object.entries(PRIORITIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select className="tfh-input" style={{ width: "auto" }} value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)}>
          <option value="all">Everyone</option>
          {users.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {canManage && hasProjects && <button className="tfh-btn tfh-btn-ghost" onClick={onBulkAdd}><ClipboardList size={14} /> Bulk add</button>}
          {hasProjects ? (
            <button className="tfh-btn tfh-btn-accent" onClick={() => onAdd("todo")}><Plus size={14} /> New task</button>
          ) : (
            <span style={{ fontSize: 12, color: "var(--text-faint)" }}>Create a project first to add tasks.</span>
          )}
        </div>
      </div>

      <div className="tfh-board-grid" style={{ display: "grid", gridTemplateColumns: `repeat(${STAGES.length}, minmax(0,1fr))`, gap: 14, flex: 1, overflowX: "auto", paddingBottom: 4, maxWidth: STAGES.length <= 2 ? 720 : "none" }}>
        {STAGES.map((stage) => (
          <Column
            key={stage.id} stage={stage} users={users} canManage={canManage} canCreate={hasProjects} currentUserId={currentUserId} showProject={showProject}
            tasks={filtered.filter((t) => t.status === stage.id)}
            onOpen={onOpen} onAdd={onAdd} onComplete={onComplete} onReopen={onReopen}
          />
        ))}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Team view                                                             */
/* ------------------------------------------------------------------ */
const ROLE_LABEL = { admin: "Admin", lead: "Lead", member: "Member" };
const ROLE_BADGE_STYLE = {
  admin: { background: "var(--stage-done)22", color: "var(--stage-done)", borderColor: "var(--stage-done)40" },
  lead: { background: "var(--accent-soft)", color: "var(--accent)", borderColor: "var(--accent)40" },
  member: { background: "var(--raised)", color: "var(--text-dim)", borderColor: "var(--line)" },
};
const RoleBadge = ({ role }) => (
  <span className="tfh-chip" style={ROLE_BADGE_STYLE[role] || ROLE_BADGE_STYLE.member}>
    {role === "admin" && <Shield size={11} />}
    {role === "lead" && <Crown size={11} />}
    {ROLE_LABEL[role] || role}
  </span>
);

const RemoveMemberButton = ({ onConfirm }) => {
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 2500); return () => clearTimeout(t); }, [armed]);
  return armed ? (
    <button className="tfh-btn tfh-btn-danger" style={{ width: "100%", fontSize: 12, marginTop: 8 }} onClick={onConfirm}>
      <UserPlus size={12} style={{ transform: "rotate(45deg)" }} /> Click to confirm removal
    </button>
  ) : (
    <button className="tfh-btn tfh-btn-ghost" style={{ width: "100%", fontSize: 12, marginTop: 8, color: "var(--pri-high)" }} onClick={() => setArmed(true)}>
      Remove from team
    </button>
  );
};

const PostEditor = ({ member, canEdit, onSave }) => {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(member.title);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setValue(member.title); }, [member.title]);

  if (!editing) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 12, color: "var(--text-dim)" }}>{member.title}</span>
        {canEdit && (
          <button type="button" onClick={() => setEditing(true)} className="tfh-btn tfh-btn-ghost" style={{ padding: 2 }} aria-label="Edit post/designation">
            <Pencil size={11} color="var(--text-faint)" />
          </button>
        )}
      </div>
    );
  }

  const save = async () => {
    if (!value.trim()) return;
    setBusy(true);
    try {
      await onSave(value.trim());
      setEditing(false);
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
      <input
        autoFocus list="post-suggestions" className="tfh-input" style={{ fontSize: 12, padding: "4px 8px" }}
        value={value} onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
      />
      <button type="button" onClick={save} disabled={busy} className="tfh-btn tfh-btn-ghost" style={{ padding: 4, flexShrink: 0 }} aria-label="Save"><Check size={12} color="var(--stage-done)" /></button>
      <button type="button" onClick={() => setEditing(false)} className="tfh-btn tfh-btn-ghost" style={{ padding: 4, flexShrink: 0 }} aria-label="Cancel"><X size={12} color="var(--text-faint)" /></button>
    </div>
  );
};

const TeamView = ({ tasks, users, currentUser, onOpen, onSetRole, onSetTitle, onInvite, onRemoveMember, canManage, workspaceId, projects, onSetProjectLead }) => {
  const isAdmin = currentUser.role === "admin";
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteStatus, setInviteStatus] = useState(null);
  const [inviting, setInviting] = useState(false);
  const [roleBusy, setRoleBusy] = useState(null);
  const [removeBusy, setRemoveBusy] = useState(null);
  const [workload, setWorkload] = useState(null);
  const [workloadLoading, setWorkloadLoading] = useState(true);

  useEffect(() => {
    if (!canManage || !workspaceId) { setWorkloadLoading(false); return; }
    let cancelled = false;
    setWorkloadLoading(true);
    api.getWorkload(workspaceId)
      .then((res) => { if (!cancelled) setWorkload(res.workload); })
      .catch(() => { if (!cancelled) setWorkload(null); })
      .finally(() => { if (!cancelled) setWorkloadLoading(false); });
    return () => { cancelled = true; };
  }, [canManage, workspaceId]);

  const chartData = (workload || []).map((w) => ({ name: w.name.split(" ")[0], active: w.active, color: users.find((u) => u.id === w.id)?.color || "var(--accent)" }));

  const submitInvite = async (e) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setInviteStatus(null);
    try {
      const result = await onInvite(inviteEmail.trim());
      setInviteStatus({ ok: true, text: result.status === "added" ? `${inviteEmail} is on the team now.` : `Invite sent — they'll join automatically when they sign up.` });
      setInviteEmail("");
    } catch (err) {
      setInviteStatus({ ok: false, text: err.message });
    } finally {
      setInviting(false);
    }
  };

  const changeRole = async (userId, role) => {
    setRoleBusy(userId);
    try {
      await onSetRole(userId, role);
    } catch (err) {
      alert(err.message);
    } finally {
      setRoleBusy(null);
    }
  };

  const removeMember = async (userId) => {
    setRemoveBusy(userId);
    try {
      await onRemoveMember(userId);
    } catch (err) {
      alert(err.message);
    } finally {
      setRemoveBusy(null);
    }
  };

  return (
    <div className="tfh-fade-in" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <datalist id="post-suggestions">
        {POST_SUGGESTIONS.map((p) => <option key={p} value={p} />)}
      </datalist>
      <div>
        <div className="tfh-display" style={{ fontSize: 26, fontWeight: 600, marginBottom: 4 }}>The team</div>
        <div style={{ fontSize: 13.5, color: "var(--text-dim)" }}>
          Signed in as <strong>{currentUser.name}</strong> · <RoleBadge role={currentUser.role} />
          {isAdmin ? " — you can assign the team lead, manage roles, and remove members." : " — only the admin can change roles."}
        </div>
      </div>

      {(() => {
        const lead = users.find((m) => m.role === "lead");
        const admin = users.find((m) => m.role === "admin");
        return (
          <div className="tfh-card" style={{ padding: "14px 18px", display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Crown size={16} color="var(--accent)" />
              <div>
                <div className="tfh-label" style={{ marginBottom: 2 }}>Team Lead</div>
                {lead ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Avatar member={lead} size={20} />
                    <span style={{ fontSize: 13.5, fontWeight: 600 }}>{lead.name}</span>
                  </div>
                ) : (
                  <span style={{ fontSize: 13, color: "var(--text-faint)" }}>Not assigned yet{isAdmin ? " — pick one below" : ""}</span>
                )}
              </div>
            </div>
            <div style={{ width: 1, alignSelf: "stretch", background: "var(--line)" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Shield size={16} color="var(--stage-done)" />
              <div>
                <div className="tfh-label" style={{ marginBottom: 2 }}>Admin</div>
                {admin && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Avatar member={admin} size={20} />
                    <span style={{ fontSize: 13.5, fontWeight: 600 }}>{admin.name}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {canManage && (
        <div className="tfh-card" style={{ padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Invite a teammate</div>
          <form onSubmit={submitInvite} style={{ display: "flex", gap: 8 }}>
            <input type="email" className="tfh-input" placeholder="teammate@company.com" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} required />
            <button className="tfh-btn tfh-btn-accent" disabled={inviting} style={{ flexShrink: 0 }}>
              <UserPlus size={14} /> {inviting ? "Sending…" : "Invite"}
            </button>
          </form>
          {inviteStatus && (
            <div style={{ fontSize: 12, marginTop: 10, color: inviteStatus.ok ? "var(--stage-done)" : "var(--pri-high)" }}>{inviteStatus.text}</div>
          )}
          <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 8 }}>
            New teammates join as <strong>Member</strong> by default — they'll only see tasks assigned to them until you promote them.
          </div>
        </div>
      )}

      {canManage && (
        <div className="tfh-card" style={{ padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 16 }}>Active workload <span style={{ fontWeight: 400, color: "var(--text-faint)" }}>— across every project</span></div>
          {workloadLoading ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "20px 0", justifyContent: "center" }}><Spinner size={16} /> <span style={{ fontSize: 12, color: "var(--text-dim)" }}>Loading…</span></div>
          ) : chartData.length === 0 ? (
            <div style={{ fontSize: 12.5, color: "var(--text-faint)", textAlign: "center", padding: "20px 0" }}>No workload data yet.</div>
          ) : (
            <div style={{ width: "100%", height: 180 }}>
              <ResponsiveContainer>
                <BarChart data={chartData} margin={{ top: 0, right: 8, left: -20, bottom: 0 }}>
                  <XAxis dataKey="name" tick={{ fill: "var(--chart-tick)", fontSize: 11 }} axisLine={{ stroke: "var(--chart-grid)" }} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fill: "var(--chart-tick)", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: "var(--chart-tooltip-bg)", border: "1px solid var(--line)", borderRadius: 8, fontSize: 12 }} cursor={{ fill: "var(--raised)" }} />
                  <Bar dataKey="active" radius={[6, 6, 0, 0]}>
                    {chartData.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
        {users.map((m) => {
          const isMe = currentUser.id === m.id;
          const showTaskInfo = canManage || isMe;
          const mine = tasks.filter((t) => t.assigneeId === m.id);
          const active = mine.filter((t) => t.status !== "done");
          return (
            <div key={m.id} className="tfh-card" style={{ padding: 16, borderColor: isMe ? "var(--accent)" : "var(--line)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <Avatar member={m} size={36} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {m.name}{isMe && <span style={{ color: "var(--text-faint)", fontWeight: 500 }}> · you</span>}
                  </div>
                  <PostEditor member={m} canEdit={isMe || isAdmin} onSave={(title) => onSetTitle(m.id, title)} />
                </div>
              </div>

              <div style={{ marginBottom: 10 }}><RoleBadge role={m.role} /></div>

              {showTaskInfo ? (
                <>
                  <div style={{ display: "flex", gap: 14, fontSize: 12, color: "var(--text-dim)", marginBottom: 10 }}>
                    <span><strong className="tfh-mono" style={{ color: "var(--text)" }}>{active.length}</strong> active</span>
                    <span><strong className="tfh-mono" style={{ color: "var(--text)" }}>{mine.length - active.length}</strong> shipped</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }}>
                    {active.slice(0, 3).map((t) => (
                      <button key={t.id} onClick={() => onOpen(t)} style={{ textAlign: "left", background: "var(--raised)", border: "none", color: "var(--text-dim)", fontSize: 12, padding: "6px 8px", borderRadius: 7 }}>{t.title}</button>
                    ))}
                    {active.length === 0 && <div style={{ fontSize: 12, color: "var(--text-faint)" }}>Nothing active — fully clear.</div>}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
                  <Lock size={11} /> Only visible to {m.name.split(" ")[0]} and the team lead
                </div>
              )}

              {isAdmin && (
                <select
                  className="tfh-input" style={{ fontSize: 12 }} value={m.role} disabled={roleBusy === m.id || removeBusy === m.id}
                  onChange={(e) => changeRole(m.id, e.target.value)}
                >
                  <option value="admin">Admin</option>
                  <option value="lead">Lead</option>
                  <option value="member">Member</option>
                </select>
              )}

              {isAdmin && projects.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 10.5, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5 }}>Lead of</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                    {projects.map((p) => {
                      const isLeadHere = p.leadId === m.id;
                      return (
                        <button
                          key={p.id}
                          onClick={() => onSetProjectLead(p.id, isLeadHere ? null : m.id)}
                          className="tfh-chip"
                          style={{
                            background: isLeadHere ? "var(--accent-soft)" : "var(--raised)",
                            color: isLeadHere ? "var(--accent)" : "var(--text-faint)",
                            border: isLeadHere ? "1px solid var(--accent)" : "1px solid transparent",
                            cursor: "pointer", fontSize: 10.5, maxWidth: 130,
                          }}
                          title={isLeadHere ? `Remove as lead of ${p.name}` : `Make lead of ${p.name}`}
                        >
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                          {isLeadHere && <X size={10} />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {isAdmin && !isMe && (
                removeBusy === m.id ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 12, color: "var(--text-dim)" }}><Spinner size={13} /> Removing…</div>
                ) : (
                  <RemoveMemberButton onConfirm={() => removeMember(m.id)} />
                )
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Calendar view                                                         */
/* ------------------------------------------------------------------ */
const CalendarView = ({ tasks, users, onOpen, workspaceId, canManage }) => {
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [selected, setSelected] = useState(null);
  const [holidays, setHolidays] = useState([]);
  const [addingHoliday, setAddingHoliday] = useState(false);
  const [holidayName, setHolidayName] = useState("");
  const [savingHoliday, setSavingHoliday] = useState(false);

  const loadHolidays = async () => {
    try {
      const { holidays } = await api.getHolidays(workspaceId);
      setHolidays(holidays);
    } catch { /* non-critical, calendar still works without it */ }
  };
  useEffect(() => { loadHolidays(); }, [workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayStr = new Date().toISOString().slice(0, 10);

  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const dateStr = (d) => `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const tasksOn = (d) => tasks.filter((t) => t.due === dateStr(d)).sort((a, b) => (a.dueTime || "99:99").localeCompare(b.dueTime || "99:99"));
  const holidayOn = (d) => holidays.find((h) => h.date === dateStr(d));
  const selectedTasks = selected ? tasksOn(selected) : [];
  const selectedHoliday = selected ? holidayOn(selected) : null;

  const submitHoliday = async (e) => {
    e.preventDefault();
    if (!selected || !holidayName.trim()) return;
    setSavingHoliday(true);
    try {
      const { holiday } = await api.addHoliday(workspaceId, dateStr(selected), holidayName.trim());
      setHolidays((prev) => [...prev.filter((h) => h.date !== holiday.date), holiday]);
      setHolidayName("");
      setAddingHoliday(false);
    } finally {
      setSavingHoliday(false);
    }
  };

  const removeHoliday = async (id) => {
    await api.deleteHoliday(workspaceId, id);
    setHolidays((prev) => prev.filter((h) => h.id !== id));
  };

  return (
    <div className="tfh-fade-in" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div>
        <div className="tfh-display" style={{ fontSize: 26, fontWeight: 600, marginBottom: 4 }}>Calendar</div>
        <div style={{ fontSize: 13.5, color: "var(--text-dim)" }}>Every dot is something due that day. Holidays are marked in gold.</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 16 }}>
        <div className="tfh-card" style={{ padding: 18 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <button className="tfh-btn tfh-btn-ghost" onClick={() => setCursor(new Date(year, month - 1, 1))}><ChevronLeft size={16} /></button>
            <span style={{ fontSize: 14, fontWeight: 700 }}>{cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</span>
            <button className="tfh-btn tfh-btn-ghost" onClick={() => setCursor(new Date(year, month + 1, 1))}><ChevronRight size={16} /></button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6, marginBottom: 6 }}>
            {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <div key={i} style={{ fontSize: 11, color: "var(--text-faint)", textAlign: "center", fontWeight: 600 }}>{d}</div>)}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
            {cells.map((d, i) => {
              if (!d) return <div key={i} />;
              const ds = dateStr(d);
              const dayTasks = tasksOn(d);
              const holiday = holidayOn(d);
              const isToday = ds === todayStr;
              const isSelected = selected === d;
              return (
                <button
                  key={i} onClick={() => setSelected(isSelected ? null : d)} title={holiday?.name}
                  style={{
                    aspectRatio: "1", borderRadius: 10,
                    border: isSelected ? "1.5px solid var(--accent)" : holiday ? "1px solid var(--pri-medium)" : "1px solid var(--line)",
                    background: holiday ? "var(--accent-soft)" : isToday ? "var(--accent-soft)" : "var(--raised)",
                    color: "var(--text)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, padding: 2,
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: isToday || holiday ? 700 : 500 }}>{d}</span>
                  <div style={{ display: "flex", gap: 2 }}>
                    {holiday && <span style={{ width: 4, height: 4, borderRadius: 999, background: "#D9A22E" }} />}
                    {dayTasks.slice(0, 3).map((t) => <span key={t.id} style={{ width: 4, height: 4, borderRadius: 999, background: PRIORITIES[t.priority].color }} />)}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="tfh-card" style={{ padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>
            {selected ? new Date(dateStr(selected) + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "Pick a day"}
          </div>

          {selected && selectedHoliday && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, background: "var(--accent-soft)", borderRadius: 9, padding: "8px 10px", marginBottom: 12 }}>
              <span style={{ fontSize: 12.5, color: "var(--accent)", fontWeight: 600 }}>🎉 {selectedHoliday.name}</span>
              {canManage && <button onClick={() => removeHoliday(selectedHoliday.id)} className="tfh-btn tfh-btn-ghost" style={{ padding: 3 }} aria-label="Remove holiday"><X size={12} /></button>}
            </div>
          )}
          {selected && !selectedHoliday && canManage && (
            addingHoliday ? (
              <form onSubmit={submitHoliday} style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                <input autoFocus className="tfh-input" placeholder="Holiday name" value={holidayName} onChange={(e) => setHolidayName(e.target.value)} style={{ fontSize: 12.5 }} />
                <button className="tfh-btn tfh-btn-accent" disabled={savingHoliday || !holidayName.trim()} style={{ flexShrink: 0, fontSize: 12 }}>{savingHoliday ? "…" : "Add"}</button>
              </form>
            ) : (
              <button onClick={() => setAddingHoliday(true)} className="tfh-btn tfh-btn-ghost" style={{ fontSize: 11.5, marginBottom: 12 }}>+ Mark as holiday</button>
            )
          )}

          {selected && selectedTasks.length === 0 && <div style={{ fontSize: 12.5, color: "var(--text-faint)" }}>Nothing due this day.</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {selectedTasks.map((t) => {
              const a = memberById(users, t.assigneeId);
              return (
                <button key={t.id} onClick={() => onOpen(t)} style={{ textAlign: "left", background: "var(--raised)", border: "1px solid var(--line)", borderRadius: 10, padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {t.dueTime && <span className="tfh-mono" style={{ fontSize: 11, color: "var(--accent)" }}>{formatTimeLabel(t.dueTime)}</span>}
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{t.title}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <PriorityChip level={t.priority} />
                    <Avatar member={a} size={20} />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Files view — project-level reference documents, not tied to a task    */
/* ------------------------------------------------------------------ */
const DocumentRow = ({ doc, workspaceId, projectId, canManage, onRemove }) => {
  const isImage = doc.mimeType.startsWith("image/");
  const sizeLabel = doc.sizeBytes > 1024 * 1024 ? `${(doc.sizeBytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(doc.sizeBytes / 1024))} KB`;

  const openOrDownload = async () => {
    try {
      const url = await api.getDocumentBlobUrl(workspaceId, projectId, doc.id);
      const a = document.createElement("a");
      a.href = url;
      if (isImage || doc.mimeType === "application/pdf") a.target = "_blank"; else a.download = doc.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch {
      // ignore — row stays put so they can retry
    }
  };

  return (
    <div className="tfh-card" style={{ padding: 14, display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ width: 38, height: 38, borderRadius: 9, background: "var(--raised)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        {isImage ? <ImageIcon size={16} color="var(--text-faint)" /> : <FileText size={16} color="var(--text-faint)" />}
      </div>
      <button type="button" onClick={openOrDownload} style={{ flex: 1, minWidth: 0, textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 500, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{doc.fileName}</div>
        <div style={{ fontSize: 11.5, color: "var(--text-faint)" }}>{sizeLabel} · {doc.uploaderName || "Unknown"} · {new Date(doc.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</div>
      </button>
      <button type="button" onClick={openOrDownload} className="tfh-btn tfh-btn-ghost" style={{ padding: 6 }} aria-label="Download"><Download size={14} color="var(--text-faint)" /></button>
      {canManage && <button type="button" onClick={onRemove} className="tfh-btn tfh-btn-ghost" style={{ padding: 6 }} aria-label="Delete"><Trash2 size={14} color="var(--text-faint)" /></button>}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Activity log — a daily entry made of text blocks and table blocks,     */
/* any number of each, matching the source activity-log documents        */
/* ------------------------------------------------------------------ */
const TableBlock = ({ block, onChange, onRemove, readOnly }) => {
  const rows = block.rows.length ? block.rows : [["", ""]];

  const setCell = (r, c, val) => {
    const next = rows.map((row, ri) => (ri === r ? row.map((cell, ci) => (ci === c ? val : cell)) : row));
    onChange({ ...block, rows: next });
  };
  const addRow = () => onChange({ ...block, rows: [...rows, rows[0].map(() => "")] });
  const addCol = () => onChange({ ...block, rows: rows.map((r) => [...r, ""]) });
  const removeRow = (i) => onChange({ ...block, rows: rows.filter((_, idx) => idx !== i) });
  const removeCol = (i) => onChange({ ...block, rows: rows.map((r) => r.filter((_, idx) => idx !== i)) });

  return (
    <div className="tfh-card" style={{ padding: 14, background: "var(--raised)" }}>
      {!readOnly && (
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" onClick={addRow} className="tfh-btn tfh-btn-ghost" style={{ fontSize: 11, padding: "4px 8px" }}>+ Row</button>
            <button type="button" onClick={addCol} className="tfh-btn tfh-btn-ghost" style={{ fontSize: 11, padding: "4px 8px" }}>+ Column</button>
          </div>
          <button type="button" onClick={onRemove} className="tfh-btn tfh-btn-ghost" style={{ padding: 4 }} aria-label="Remove table"><Trash2 size={12} color="var(--pri-high)" /></button>
        </div>
      )}
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td key={ci} style={{ border: "1px solid var(--line)", padding: 0 }}>
                    {readOnly ? (
                      <div style={{ padding: "6px 8px", fontSize: 12.5, minWidth: 90 }}>{cell}</div>
                    ) : (
                      <input
                        value={cell} onChange={(e) => setCell(ri, ci, e.target.value)}
                        style={{ border: "none", background: "transparent", padding: "6px 8px", fontSize: 12.5, width: "100%", minWidth: 90, color: "var(--text)" }}
                      />
                    )}
                  </td>
                ))}
                {!readOnly && rows.length > 1 && (
                  <td style={{ border: "none", padding: "0 4px" }}>
                    <button type="button" onClick={() => removeRow(ri)} className="tfh-btn tfh-btn-ghost" style={{ padding: 3 }} aria-label="Remove row"><X size={10} color="var(--text-faint)" /></button>
                  </td>
                )}
              </tr>
            ))}
            {!readOnly && rows[0].length > 1 && (
              <tr>
                {rows[0].map((_, ci) => (
                  <td key={ci} style={{ border: "none", textAlign: "center", padding: "2px 0" }}>
                    <button type="button" onClick={() => removeCol(ci)} className="tfh-btn tfh-btn-ghost" style={{ padding: 3 }} aria-label="Remove column"><X size={10} color="var(--text-faint)" /></button>
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const TextBlockLinks = ({ links, onChange, readOnly }) => {
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");

  const add = (e) => {
    e.preventDefault();
    if (!url.trim()) return;
    onChange([...links, { label: label.trim() || url.trim(), url: url.trim() }]);
    setLabel(""); setUrl("");
  };
  const remove = (i) => onChange(links.filter((_, idx) => idx !== i));

  if (readOnly) {
    if (links.length === 0) return null;
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
        {links.map((l, i) => (
          <a key={i} href={l.url} target="_blank" rel="noreferrer" className="tfh-chip tfh-mono" style={{ background: "var(--accent-soft)", color: "var(--accent)", textDecoration: "none" }}>
            <Link2 size={10} /> {l.label}
          </a>
        ))}
      </div>
    );
  }

  return (
    <div style={{ marginTop: 6 }}>
      {links.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 5 }}>
          {links.map((l, i) => (
            <span key={i} className="tfh-chip tfh-mono" style={{ background: "var(--raised)", color: "var(--text-dim)" }}>
              <Link2 size={10} /> {l.label}
              <button type="button" onClick={() => remove(i)} style={{ background: "none", border: "none", padding: 0, marginLeft: 3, display: "flex" }} aria-label="Remove link"><X size={10} /></button>
            </span>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 5 }}>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label" className="tfh-input" style={{ fontSize: 11, flex: "0 0 32%", padding: "5px 8px" }} />
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste a link (Google Drive, etc.)" className="tfh-input" style={{ fontSize: 11, padding: "5px 8px" }} />
        <button type="button" onClick={add} className="tfh-btn tfh-btn-ghost" style={{ padding: "4px 8px", flexShrink: 0 }} aria-label="Add link"><Plus size={11} /></button>
      </div>
    </div>
  );
};

const BlockEditor = ({ content, setContent, readOnly, projects }) => {
  const updateBlock = (i, next) => setContent((prev) => prev.map((b, idx) => (idx === i ? next : b)));
  const removeBlock = (i) => setContent((prev) => prev.filter((_, idx) => idx !== i));
  const addText = () => setContent((prev) => [...prev, { type: "text", text: "", time: "", links: [], projectId: "" }]);
  const addTable = () => setContent((prev) => [...prev, { type: "table", rows: [["", ""], ["", ""]] }]);
  const projectName = (id) => projects.find((p) => p.id === id)?.name;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {content.map((block, i) => (
        <div key={i}>
          {block.type === "text" ? (
            readOnly ? (
              (block.text || (block.links || []).length > 0) && (
                <div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                    {block.time && <span className="tfh-mono" style={{ fontSize: 11.5, color: "var(--accent)", flexShrink: 0 }}>{formatTimeLabel(block.time)}</span>}
                    {block.text && <div style={{ fontSize: 13, color: "var(--text)", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{block.text}</div>}
                    {block.projectId && projectName(block.projectId) && (
                      <span className="tfh-chip" style={{ fontSize: 10, background: "var(--raised)", color: "var(--text-faint)" }}>
                        <FolderKanban size={9} /> {projectName(block.projectId)}
                      </span>
                    )}
                  </div>
                  <TextBlockLinks links={block.links || []} readOnly />
                </div>
              )
            ) : (
              <div className="tfh-card" style={{ padding: 12, background: "var(--raised)" }}>
                <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "flex-start" }}>
                  <input
                    type="time" className="tfh-input" style={{ width: 110, fontSize: 12, flexShrink: 0 }}
                    value={block.time || ""} onChange={(e) => updateBlock(i, { ...block, time: e.target.value })}
                    aria-label="Time"
                  />
                  <div style={{ position: "relative", flex: 1 }}>
                    <textarea
                      className="tfh-input" rows={2} placeholder="What did you work on?"
                      value={block.text} onChange={(e) => updateBlock(i, { ...block, text: e.target.value })}
                      style={{ resize: "vertical", paddingRight: 30 }}
                    />
                    <button type="button" onClick={() => removeBlock(i)} className="tfh-btn tfh-btn-ghost" style={{ position: "absolute", top: 4, right: 4, padding: 3 }} aria-label="Remove"><X size={11} color="var(--text-faint)" /></button>
                  </div>
                </div>
                <select
                  className="tfh-input" style={{ fontSize: 11.5, marginBottom: 8 }}
                  value={block.projectId || ""} onChange={(e) => updateBlock(i, { ...block, projectId: e.target.value })}
                  aria-label="Which project was this for"
                >
                  <option value="">No specific project</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <TextBlockLinks links={block.links || []} onChange={(links) => updateBlock(i, { ...block, links })} />
              </div>
            )
          ) : (
            <TableBlock block={block} onChange={(next) => updateBlock(i, next)} onRemove={() => removeBlock(i)} readOnly={readOnly} />
          )}
        </div>
      ))}
      {content.length === 0 && readOnly && <div style={{ fontSize: 12.5, color: "var(--text-faint)" }}>Nothing logged for this day.</div>}
      {!readOnly && (
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={addText} className="tfh-btn" style={{ fontSize: 12 }}><Plus size={12} /> Add text</button>
          <button type="button" onClick={addTable} className="tfh-btn" style={{ fontSize: 12 }}><TableIcon size={12} /> Add table</button>
        </div>
      )}
    </div>
  );
};

const ActivityLogView = ({ workspaceId, currentUser, canManage, projects }) => {
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [myLogs, setMyLogs] = useState([]);
  const [content, setContent] = useState([]);
  const [tab, setTab] = useState("mine");
  const [teamLogs, setTeamLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [teamLoading, setTeamLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [fileError, setFileError] = useState("");

  const loadMine = async () => {
    setLoading(true);
    try {
      const { logs } = await api.getMyActivityLogs(workspaceId);
      setMyLogs(logs);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { loadMine(); }, [workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const existing = myLogs.find((l) => l.entryDate === selectedDate);
    setContent(existing ? existing.content : []);
    setSaved(false);
  }, [selectedDate, myLogs]);

  const entryExists = myLogs.some((l) => l.entryDate === selectedDate);

  useEffect(() => {
    if (tab !== "mine") return;
    setAttachmentsLoading(true);
    setFileError("");
    api.getActivityLogAttachments(workspaceId, selectedDate).then(({ attachments }) => setAttachments(attachments)).finally(() => setAttachmentsLoading(false));
  }, [workspaceId, selectedDate, tab, entryExists]);

  const handleFiles = async (fileList) => {
    const { accepted, rejected } = validateFiles(fileList);
    if (rejected.length) setFileError(`${rejected.join(", ")} — over the ${MAX_FILE_MB}MB limit, not added.`);
    else setFileError("");
    if (accepted.length === 0) return;
    setUploading(true);
    try {
      for (const file of accepted) {
        const { attachment } = await api.uploadActivityLogAttachment(workspaceId, selectedDate, file);
        setAttachments((prev) => [...prev, attachment]);
      }
    } catch (err) {
      setFileError(err.message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };
  const removeFile = async (attachmentId) => {
    await api.deleteActivityLogAttachment(workspaceId, selectedDate, attachmentId);
    setAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
  };
  const openFile = async (attachmentId, fileName, isImage) => {
    try {
      const url = await api.getActivityLogAttachmentBlobUrl(workspaceId, selectedDate, attachmentId);
      const a = document.createElement("a");
      a.href = url;
      if (isImage) a.target = "_blank"; else a.download = fileName;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    if (tab !== "team") return;
    setTeamLoading(true);
    api.getTeamActivityLogs(workspaceId).then(({ logs }) => setTeamLogs(logs)).finally(() => setTeamLoading(false));
  }, [tab, canManage, workspaceId]);

  const save = async () => {
    setSaving(true);
    try {
      const { log } = await api.saveActivityLog(workspaceId, selectedDate, content);
      setMyLogs((prev) => {
        const others = prev.filter((l) => l.entryDate !== selectedDate);
        return [...others, log].sort((a, b) => b.entryDate.localeCompare(a.entryDate));
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const groupedByDate = {};
  teamLogs.forEach((l) => { (groupedByDate[l.entryDate] = groupedByDate[l.entryDate] || []).push(l); });

  return (
    <div className="tfh-fade-in" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <div className="tfh-display" style={{ fontSize: 26, fontWeight: 600, marginBottom: 4 }}>Activity Log</div>
        <div style={{ fontSize: 13.5, color: "var(--text-dim)" }}>What you worked on, day by day. Add text notes or tables — as many of each as you need.</div>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button className={`tfh-btn ${tab === "mine" ? "tfh-btn-accent" : ""}`} onClick={() => setTab("mine")}>My log</button>
        <button className={`tfh-btn ${tab === "team" ? "tfh-btn-accent" : ""}`} onClick={() => setTab("team")}>Team log</button>
      </div>

      {tab === "mine" ? (
        <>
          <div className="tfh-card" style={{ padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
              <input type="date" className="tfh-input" style={{ width: "auto" }} value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} max={new Date().toISOString().slice(0, 10)} />
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {saved && <span style={{ fontSize: 12, color: "var(--stage-done)" }}>Saved</span>}
                <button className="tfh-btn tfh-btn-accent" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save entry"}</button>
              </div>
            </div>
            <BlockEditor content={content} setContent={setContent} projects={projects} />

            <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
              <div className="tfh-label" style={{ marginBottom: 10 }}>Files for this entry</div>
              {!entryExists ? (
                <div style={{ fontSize: 12, color: "var(--text-faint)" }}>Save this day's entry first, then you can attach files here.</div>
              ) : (
                <>
                  {attachmentsLoading ? (
                    <div style={{ fontSize: 12, color: "var(--text-faint)" }}>Loading…</div>
                  ) : attachments.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
                      {attachments.map((a) => (
                        <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 7, padding: "5px 8px", borderRadius: 7, background: "var(--raised)" }}>
                          {a.mimeType?.startsWith("image/") ? <ImageIcon size={12} color="var(--text-faint)" /> : <Paperclip size={12} color="var(--text-faint)" />}
                          <button type="button" onClick={() => openFile(a.id, a.fileName, a.mimeType?.startsWith("image/"))} style={{ flex: 1, minWidth: 0, textAlign: "left", background: "none", border: "none", fontSize: 12, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.fileName}</button>
                          <button type="button" onClick={() => removeFile(a.id)} className="tfh-btn tfh-btn-ghost" style={{ padding: 3 }} aria-label="Remove file"><X size={11} /></button>
                        </div>
                      ))}
                    </div>
                  )}
                  <input ref={fileInputRef} type="file" multiple style={{ display: "none" }} onChange={(e) => handleFiles(e.target.files)} />
                  <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading} className="tfh-btn tfh-btn-ghost" style={{ fontSize: 11.5, padding: "4px 9px" }}>
                    <Upload size={11} /> {uploading ? "Uploading…" : "Add file"}
                  </button>
                  {fileError && <div style={{ fontSize: 11, color: "var(--pri-high)", marginTop: 6 }}>{fileError}</div>}
                </>
              )}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Past entries</div>
            {loading ? (
              <div style={{ fontSize: 12.5, color: "var(--text-faint)" }}>Loading…</div>
            ) : myLogs.length === 0 ? (
              <div style={{ fontSize: 12.5, color: "var(--text-faint)" }}>No entries yet.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {myLogs.map((l) => (
                  <button key={l.id} onClick={() => setSelectedDate(l.entryDate)} className="tfh-card" style={{ padding: "10px 14px", textAlign: "left", display: "flex", alignItems: "center", justifyContent: "space-between", border: l.entryDate === selectedDate ? "1px solid var(--accent)" : undefined }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600 }}>{new Date(l.entryDate + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}</span>
                    <span style={{ fontSize: 11, color: "var(--text-faint)" }}>{l.content.length} {l.content.length === 1 ? "activity" : "activities"}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {teamLoading ? (
            <div style={{ fontSize: 12.5, color: "var(--text-faint)" }}>Loading…</div>
          ) : Object.keys(groupedByDate).length === 0 ? (
            <div style={{ fontSize: 12.5, color: "var(--text-faint)" }}>No entries logged by the team yet.</div>
          ) : (
            Object.entries(groupedByDate).sort((a, b) => b[0].localeCompare(a[0])).map(([date, entries]) => (
              <div key={date}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>{new Date(date + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {entries.map((l) => (
                    <div key={l.id} className="tfh-card" style={{ padding: 16 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                        <Avatar member={{ name: l.userName, color: l.userColor, initials: l.userInitials }} size={22} />
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{l.userName}</span>
                      </div>
                      <BlockEditor content={l.content} setContent={() => {}} readOnly projects={projects} />
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

const DocumentsView = ({ workspaceId, projectId, projectName, canManage }) => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef(null);

  const load = async () => {
    setLoading(true);
    try {
      const { documents } = await api.getDocuments(workspaceId, projectId);
      setItems(documents);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [workspaceId, projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setUploading(true);
    setError("");
    try {
      for (const file of files) await api.uploadDocument(workspaceId, projectId, file);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const remove = async (id) => {
    try {
      await api.deleteDocument(workspaceId, projectId, id);
      setItems((prev) => prev.filter((d) => d.id !== id));
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="tfh-fade-in" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="tfh-display" style={{ fontSize: 26, fontWeight: 600, marginBottom: 4 }}>Files</div>
          <div style={{ fontSize: 13.5, color: "var(--text-dim)" }}>Reference documents for {projectName || "this project"} — visible to everyone here, not tied to a single task.</div>
        </div>
        {canManage && (
          <>
            <input ref={fileInputRef} type="file" multiple style={{ display: "none" }} onChange={(e) => handleFiles(e.target.files)} />
            <button className="tfh-btn tfh-btn-accent" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              <Upload size={14} /> {uploading ? "Uploading…" : "Upload file"}
            </button>
          </>
        )}
      </div>

      {error && <div style={{ fontSize: 12.5, color: "var(--pri-high)" }}>{error}</div>}

      {loading ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 30, justifyContent: "center" }}><Spinner /> <span style={{ fontSize: 13, color: "var(--text-dim)" }}>Loading files…</span></div>
      ) : items.length === 0 ? (
        <div className="tfh-card" style={{ padding: 30, textAlign: "center" }}>
          <FolderOpen size={22} color="var(--text-faint)" style={{ marginBottom: 8 }} />
          <div style={{ fontSize: 13, color: "var(--text-dim)" }}>
            {canManage ? "No files yet — upload circulars, guidelines, or reference material for the whole team." : "No files here yet."}
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {items.map((doc) => (
            <DocumentRow key={doc.id} doc={doc} workspaceId={workspaceId} projectId={projectId} canManage={canManage} onRemove={() => remove(doc.id)} />
          ))}
        </div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Milestone view — exactly one per project, editable by admin/lead      */
/* ------------------------------------------------------------------ */
const LinksList = ({ links, canManage, onAdd, onRemove, compact }) => {
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    setError("");
    try {
      await onAdd(label.trim(), url.trim());
      setLabel(""); setUrl("");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {links.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: canManage ? 10 : 0 }}>
          {links.map((l) => (
            <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: compact ? "5px 8px" : "6px 8px", borderRadius: 8, background: "var(--raised)" }}>
              <Link2 size={13} color="var(--text-faint)" style={{ flexShrink: 0 }} />
              <a href={l.url} target="_blank" rel="noopener noreferrer" style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: "var(--accent)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textDecoration: "none" }}>{l.label}</a>
              {canManage && <button type="button" onClick={() => onRemove(l.id)} className="tfh-btn tfh-btn-ghost" style={{ padding: 4 }} aria-label="Remove link"><X size={12} color="var(--text-faint)" /></button>}
            </div>
          ))}
        </div>
      )}
      {links.length === 0 && !canManage && <div style={{ fontSize: 12, color: "var(--text-faint)" }}>No links yet.</div>}
      {canManage && (
        <form onSubmit={submit} style={{ display: "flex", gap: 6 }}>
          <input className="tfh-input" placeholder="Label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} style={{ flex: "0 0 38%", fontSize: 12.5 }} />
          <input className="tfh-input" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} style={{ fontSize: 12.5 }} />
          <button className="tfh-btn" disabled={busy || !url.trim()} style={{ flexShrink: 0 }}><Plus size={13} /></button>
        </form>
      )}
      {error && <div style={{ fontSize: 11.5, color: "var(--pri-high)", marginTop: 6 }}>{error}</div>}
    </div>
  );
};

const MilestoneAttachmentsMini = ({ workspaceId, projectId, milestoneId, attachments, canManage, onAdd, onRemove }) => {
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  const handleFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setUploading(true);
    try {
      for (const file of files) {
        const { attachment } = await api.uploadMilestoneAttachment(workspaceId, projectId, milestoneId, file);
        onAdd(attachment);
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const openFile = async (attachmentId, fileName, isImage) => {
    try {
      const url = await api.getMilestoneAttachmentBlobUrl(workspaceId, projectId, milestoneId, attachmentId);
      const a = document.createElement("a");
      a.href = url;
      if (isImage) a.target = "_blank"; else a.download = fileName;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch { /* ignore — row stays put to retry */ }
  };

  const remove = async (id) => {
    await api.deleteMilestoneAttachment(workspaceId, projectId, milestoneId, id);
    onRemove(id);
  };

  return (
    <div style={{ marginTop: 10 }}>
      {(attachments || []).length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: canManage ? 6 : 0 }}>
          {attachments.map((a) => (
            <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 7, padding: "5px 8px", borderRadius: 7, background: "var(--raised)" }}>
              {a.mimeType?.startsWith("image/") ? <ImageIcon size={12} color="var(--text-faint)" /> : <Paperclip size={12} color="var(--text-faint)" />}
              <button type="button" onClick={() => openFile(a.id, a.fileName, a.mimeType?.startsWith("image/"))} style={{ flex: 1, minWidth: 0, textAlign: "left", background: "none", border: "none", fontSize: 12, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.fileName}</button>
              {canManage && <button type="button" onClick={() => remove(a.id)} className="tfh-btn tfh-btn-ghost" style={{ padding: 3 }} aria-label="Remove file"><X size={11} /></button>}
            </div>
          ))}
        </div>
      )}
      {canManage && (
        <>
          <input ref={fileInputRef} type="file" multiple style={{ display: "none" }} onChange={(e) => handleFiles(e.target.files)} />
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading} className="tfh-btn tfh-btn-ghost" style={{ fontSize: 11, padding: "4px 8px" }}>
            <Upload size={11} /> {uploading ? "Uploading…" : "Add file"}
          </button>
        </>
      )}
    </div>
  );
};

const MilestoneCard = ({ milestone, index, total, canManage, onEdit, onDelete, onMove, onAddLink, onRemoveLink, workspaceId, projectId, onAddAttachment, onRemoveAttachment }) => {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(milestone.title);
  const [description, setDescription] = useState(milestone.description);
  const [targetDate, setTargetDate] = useState(milestone.targetDate || "");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      await onEdit(milestone.id, { title: title.trim(), description, targetDate: targetDate || null });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <form onSubmit={save} className="tfh-card" style={{ padding: 18 }}>
        <input autoFocus className="tfh-input" placeholder="Milestone title" value={title} onChange={(e) => setTitle(e.target.value)} style={{ marginBottom: 10 }} />
        <textarea className="tfh-input" rows={2} placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} style={{ marginBottom: 10, resize: "vertical" }} />
        <input type="date" className="tfh-input" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} style={{ marginBottom: 12 }} />
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="tfh-btn" onClick={() => setEditing(false)}>Cancel</button>
          <button className="tfh-btn tfh-btn-accent" disabled={saving || !title.trim()}>{saving ? "Saving…" : "Save"}</button>
        </div>
      </form>
    );
  }

  return (
    <div className="tfh-card" style={{ padding: 18 }}>
      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, paddingTop: 2 }}>
          <div style={{ width: 26, height: 26, borderRadius: 999, background: "var(--accent-soft)", color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>{index + 1}</div>
          {canManage && (
            <div style={{ display: "flex", flexDirection: "column" }}>
              <button type="button" disabled={index === 0} onClick={() => onMove(milestone.id, "up")} className="tfh-btn tfh-btn-ghost" style={{ padding: 2, opacity: index === 0 ? 0.3 : 1 }} aria-label="Move up"><ChevronUp size={13} /></button>
              <button type="button" disabled={index === total - 1} onClick={() => onMove(milestone.id, "down")} className="tfh-btn tfh-btn-ghost" style={{ padding: 2, opacity: index === total - 1 ? 0.3 : 1 }} aria-label="Move down"><ChevronDown size={13} /></button>
            </div>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>{milestone.title}</span>
            {canManage && (
              <div style={{ display: "flex", gap: 4 }}>
                <button className="tfh-btn tfh-btn-ghost" style={{ padding: 5 }} onClick={() => setEditing(true)} aria-label="Edit"><Pencil size={12} /></button>
                {confirmDelete ? (
                  <button className="tfh-btn tfh-btn-ghost" style={{ padding: 5, color: "var(--pri-high)" }} onClick={() => onDelete(milestone.id)} aria-label="Confirm delete"><Check size={12} /></button>
                ) : (
                  <button className="tfh-btn tfh-btn-ghost" style={{ padding: 5 }} onClick={() => setConfirmDelete(true)} aria-label="Delete"><Trash2 size={12} /></button>
                )}
              </div>
            )}
          </div>
          {milestone.description && <div style={{ fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.5, marginBottom: 8 }}>{milestone.description}</div>}
          {milestone.targetDate && (
            <div className="tfh-chip" style={{ background: "var(--accent-soft)", color: "var(--accent)", marginBottom: 10 }}>
              <CalendarDays size={11} /> Target: {new Date(milestone.targetDate + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
            </div>
          )}
          <LinksList
            links={milestone.links || []} canManage={canManage} compact
            onAdd={(label, url) => onAddLink(milestone.id, label, url)}
            onRemove={(linkId) => onRemoveLink(milestone.id, linkId)}
          />
          <MilestoneAttachmentsMini
            workspaceId={workspaceId} projectId={projectId} milestoneId={milestone.id}
            attachments={milestone.attachments || []} canManage={canManage}
            onAdd={(attachment) => onAddAttachment(milestone.id, attachment)}
            onRemove={(attachmentId) => onRemoveAttachment(milestone.id, attachmentId)}
          />
        </div>
      </div>
    </div>
  );
};

const ProjectLeadCard = ({ workspaceId, projectId, project, isAdmin, users, onProjectUpdated }) => {
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState(project?.leadId || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const { project: updated } = await api.setProjectLead(workspaceId, projectId, selected || null);
      onProjectUpdated(updated);
      setEditing(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="tfh-card" style={{ padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: editing ? 12 : 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Crown size={16} color="var(--accent)" />
          <div>
            <div className="tfh-label" style={{ marginBottom: 2 }}>Project Lead</div>
            {project?.leadId ? (
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Avatar member={{ name: project.leadName, color: project.leadColor, initials: project.leadInitials }} size={20} />
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>{project.leadName}</span>
              </div>
            ) : (
              <span style={{ fontSize: 13, color: "var(--text-faint)" }}>Not assigned — this project follows the workspace admin/lead by default.</span>
            )}
          </div>
        </div>
        {isAdmin && !editing && (
          <button className="tfh-btn tfh-btn-ghost" style={{ fontSize: 11.5 }} onClick={() => { setSelected(project?.leadId || ""); setEditing(true); }}>
            <Pencil size={11} /> Change
          </button>
        )}
      </div>
      {editing && (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select className="tfh-input" value={selected} onChange={(e) => setSelected(e.target.value)} style={{ fontSize: 12.5 }}>
            <option value="">No project lead</option>
            {users.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <button className="tfh-btn" onClick={() => setEditing(false)}>Cancel</button>
          <button className="tfh-btn tfh-btn-accent" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        </div>
      )}
      {error && <div style={{ fontSize: 11.5, color: "var(--pri-high)", marginTop: 8 }}>{error}</div>}
      <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 10, lineHeight: 1.4 }}>
        A project's own lead can manage this project's tasks, milestones, and files, the same as the workspace admin/lead — scoped to just this project.
      </div>
    </div>
  );
};

const ProjectInfoCard = ({ workspaceId, projectId, project, canManage, onProjectUpdated }) => {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(project?.name || "");
  const [description, setDescription] = useState(project?.description || "");
  const [deadline, setDeadline] = useState(project?.deadline || "");
  const [startDate, setStartDate] = useState(project?.hasExplicitStartDate ? project.startDate : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const startEdit = () => {
    setName(project?.name || "");
    setDescription(project?.description || "");
    setDeadline(project?.deadline || "");
    setStartDate(project?.hasExplicitStartDate ? project.startDate : "");
    setError("");
    setEditing(true);
  };

  const save = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError("");
    try {
      const { project: updated } = await api.updateProject(workspaceId, projectId, { name: name.trim(), description, deadline: deadline || null, startDate: startDate || null });
      onProjectUpdated(updated);
      setEditing(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <form onSubmit={save} className="tfh-card" style={{ padding: 20 }}>
        <label className="tfh-label" htmlFor="proj-edit-name">Project name</label>
        <input id="proj-edit-name" className="tfh-input" value={name} onChange={(e) => setName(e.target.value)} style={{ marginBottom: 12 }} />
        <label className="tfh-label" htmlFor="proj-edit-desc">Description</label>
        <textarea id="proj-edit-desc" className="tfh-input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} style={{ marginBottom: 12, resize: "vertical" }} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 6 }}>
          <div>
            <label className="tfh-label" htmlFor="proj-edit-start">Start date</label>
            <input id="proj-edit-start" type="date" className="tfh-input" value={startDate || ""} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div>
            <label className="tfh-label" htmlFor="proj-edit-deadline">Deadline</label>
            <input id="proj-edit-deadline" type="date" className="tfh-input" value={deadline || ""} onChange={(e) => setDeadline(e.target.value)} />
          </div>
        </div>
        <div style={{ fontSize: 11, color: "var(--text-faint)", marginBottom: 14 }}>
          Leave start date blank to use when the project was created ({new Date(project.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}).
        </div>
        {error && <div style={{ fontSize: 12, color: "var(--pri-high)", marginBottom: 12 }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="tfh-btn" onClick={() => setEditing(false)}>Cancel</button>
          <button className="tfh-btn tfh-btn-accent" disabled={saving || !name.trim()}>{saving ? "Saving…" : "Save"}</button>
        </div>
      </form>
    );
  }

  return (
    <div className="tfh-card" style={{ padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>Project timeline</span>
        {canManage && <button className="tfh-btn tfh-btn-ghost" style={{ fontSize: 11.5 }} onClick={startEdit}><Pencil size={11} /> Edit</button>}
      </div>
      <div style={{ fontSize: 13, color: "var(--text)", marginTop: 6 }}>
        {project?.startDate && new Date(project.startDate + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
        {!project?.hasExplicitStartDate && <span style={{ color: "var(--text-faint)" }}> (from creation date)</span>}
        {" – "}
        {project?.deadline ? new Date(project.deadline + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : <span style={{ color: "var(--text-faint)" }}>no deadline set</span>}
      </div>
      {project?.description && <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginTop: 10, lineHeight: 1.5 }}>{project.description}</div>}
    </div>
  );
};

const MilestonesView = ({ workspaceId, projectId, project, canManage, isAdmin, users, onProjectUpdated }) => {
  const [milestones, setMilestones] = useState([]);
  const [projectLinks, setProjectLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newDate, setNewDate] = useState("");
  const [newLinks, setNewLinks] = useState([]);
  const [newLinkLabel, setNewLinkLabel] = useState("");
  const [newLinkUrl, setNewLinkUrl] = useState("");
  const [newFiles, setNewFiles] = useState([]);
  const newFileInputRef = useRef(null);
  const [creating, setCreating] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const [msRes, linksRes] = await Promise.all([api.getMilestones(workspaceId, projectId), api.getProjectLinks(workspaceId, projectId)]);
      setMilestones(msRes.milestones);
      setProjectLinks(linksRes.links);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); setAdding(false); }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const createNew = async (e) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setCreating(true);
    setError("");
    try {
      const { milestone } = await api.createMilestone(workspaceId, projectId, { title: newTitle.trim(), description: newDesc, targetDate: newDate || null });

      // Upload whatever links/files were staged before the milestone existed
      // — same pattern as subtask creation: stage locally, upload once a
      // real id exists.
      const uploadJobs = [
        ...newLinks.map((l) => api.addMilestoneLink(workspaceId, projectId, milestone.id, l.label, l.url)),
        ...newFiles.map((f) => api.uploadMilestoneAttachment(workspaceId, projectId, milestone.id, f)),
      ];
      if (uploadJobs.length > 0) await Promise.all(uploadJobs);

      // Refetch so the new milestone's card shows its freshly-uploaded links/files immediately.
      const { milestones: refreshed } = await api.getMilestones(workspaceId, projectId);
      setMilestones(refreshed);
      setNewTitle(""); setNewDesc(""); setNewDate(""); setNewLinks([]); setNewFiles([]); setAdding(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const addNewLink = (e) => {
    e.preventDefault();
    if (!newLinkUrl.trim()) return;
    setNewLinks((prev) => [...prev, { label: newLinkLabel.trim() || newLinkUrl.trim(), url: newLinkUrl.trim() }]);
    setNewLinkLabel(""); setNewLinkUrl("");
  };
  const removeNewLink = (i) => setNewLinks((prev) => prev.filter((_, idx) => idx !== i));
  const handleNewFiles = (fileList) => setNewFiles((prev) => [...prev, ...Array.from(fileList || [])]);
  const removeNewFile = (i) => setNewFiles((prev) => prev.filter((_, idx) => idx !== i));

  const editMilestone = async (id, patch) => {
    const { milestone } = await api.updateMilestone(workspaceId, projectId, id, patch);
    setMilestones((prev) => prev.map((m) => (m.id === id ? { ...milestone, links: m.links } : m)));
  };
  const deleteMilestoneHandler = async (id) => {
    await api.deleteMilestone(workspaceId, projectId, id);
    setMilestones((prev) => prev.filter((m) => m.id !== id));
  };
  const moveMilestoneHandler = async (id, direction) => {
    const { milestones: reordered } = await api.moveMilestone(workspaceId, projectId, id, direction);
    setMilestones((prev) => reordered.map((m) => ({ ...m, links: prev.find((p) => p.id === m.id)?.links || [] })));
  };
  const addLinkToMilestone = async (milestoneId, label, url) => {
    const { link } = await api.addMilestoneLink(workspaceId, projectId, milestoneId, label, url);
    setMilestones((prev) => prev.map((m) => (m.id === milestoneId ? { ...m, links: [...(m.links || []), link] } : m)));
  };
  const removeLinkFromMilestone = async (milestoneId, linkId) => {
    await api.deleteMilestoneLink(workspaceId, projectId, milestoneId, linkId);
    setMilestones((prev) => prev.map((m) => (m.id === milestoneId ? { ...m, links: m.links.filter((l) => l.id !== linkId) } : m)));
  };

  // The upload itself already happened by the time these fire (see
  // MilestoneAttachmentsMini) — this just keeps local state in sync.
  const addAttachmentToMilestone = (milestoneId, attachment) => {
    setMilestones((prev) => prev.map((m) => (m.id === milestoneId ? { ...m, attachments: [...(m.attachments || []), attachment] } : m)));
  };
  const removeAttachmentFromMilestone = (milestoneId, attachmentId) => {
    setMilestones((prev) => prev.map((m) => (m.id === milestoneId ? { ...m, attachments: (m.attachments || []).filter((a) => a.id !== attachmentId) } : m)));
  };

  const addProjectLink = async (label, url) => {
    const { link } = await api.addProjectLink(workspaceId, projectId, label, url);
    setProjectLinks((prev) => [...prev, link]);
  };
  const removeProjectLink = async (linkId) => {
    await api.deleteProjectLink(workspaceId, projectId, linkId);
    setProjectLinks((prev) => prev.filter((l) => l.id !== linkId));
  };

  const toggleComplete = async (complete) => {
    setCompleting(true);
    try {
      const { project: updated } = await api.setProjectComplete(workspaceId, projectId, complete);
      onProjectUpdated(updated);
      setConfirmComplete(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setCompleting(false);
    }
  };

  const isComplete = !!project?.completedAt;

  return (
    <div className="tfh-fade-in" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <div className="tfh-display" style={{ fontSize: 26, fontWeight: 600, marginBottom: 4 }}>Milestones</div>
        <div style={{ fontSize: 13.5, color: "var(--text-dim)" }}>The roadmap for this project, in order — set and updated by the admin or team lead.</div>
      </div>

      {isComplete && (
        <div className="tfh-card" style={{ padding: 18, borderColor: "var(--stage-done)", display: "flex", alignItems: "center", gap: 12 }}>
          <Check size={18} color="var(--stage-done)" />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>Project complete</div>
            <div style={{ fontSize: 12, color: "var(--text-dim)" }}>Marked done on {new Date(project.completedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}. Its tasks and files stay available in Project History.</div>
          </div>
          {canManage && <button className="tfh-btn" onClick={() => toggleComplete(false)} disabled={completing}>{completing ? "…" : "Reopen"}</button>}
        </div>
      )}

      <ProjectInfoCard workspaceId={workspaceId} projectId={projectId} project={project} canManage={canManage} onProjectUpdated={onProjectUpdated} />

      <ProjectLeadCard workspaceId={workspaceId} projectId={projectId} project={project} isAdmin={isAdmin} users={users} onProjectUpdated={onProjectUpdated} />

      <div className="tfh-card" style={{ padding: 20 }}>
        <span style={{ fontSize: 13, fontWeight: 700, display: "block", marginBottom: 10 }}>Project reference links</span>
        <LinksList links={projectLinks} canManage={canManage} onAdd={addProjectLink} onRemove={removeProjectLink} />
      </div>

      {loading ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 30, justifyContent: "center" }}><Spinner /> <span style={{ fontSize: 13, color: "var(--text-dim)" }}>Loading…</span></div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {milestones.map((m, i) => (
            <MilestoneCard
              key={m.id} milestone={m} index={i} total={milestones.length} canManage={canManage}
              onEdit={editMilestone} onDelete={deleteMilestoneHandler} onMove={moveMilestoneHandler}
              onAddLink={addLinkToMilestone} onRemoveLink={removeLinkFromMilestone}
              workspaceId={workspaceId} projectId={projectId}
              onAddAttachment={addAttachmentToMilestone} onRemoveAttachment={removeAttachmentFromMilestone}
            />
          ))}
          {milestones.length === 0 && (
            <div className="tfh-card" style={{ padding: 30, textAlign: "center" }}>
              <Flag size={22} color="var(--text-faint)" style={{ marginBottom: 8 }} />
              <div style={{ fontSize: 13, color: "var(--text-dim)" }}>No milestones yet for this project.</div>
            </div>
          )}
          {canManage && (
            adding ? (
              <form onSubmit={createNew} className="tfh-card" style={{ padding: 18, borderColor: "var(--accent)" }}>
                <input autoFocus className="tfh-input" placeholder="Milestone title" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} style={{ marginBottom: 10 }} />
                <textarea className="tfh-input" rows={2} placeholder="Description (optional)" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} style={{ marginBottom: 10, resize: "vertical" }} />
                <input type="date" className="tfh-input" value={newDate} onChange={(e) => setNewDate(e.target.value)} style={{ marginBottom: 14 }} />

                <label className="tfh-label" style={{ fontSize: 10 }}>Links</label>
                {newLinks.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 6 }}>
                    {newLinks.map((l, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 7, padding: "4px 7px", borderRadius: 6, background: "var(--raised)" }}>
                        <Link2 size={11} color="var(--text-faint)" />
                        <span style={{ flex: 1, fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.label}</span>
                        <button type="button" onClick={() => removeNewLink(i)} className="tfh-btn tfh-btn-ghost" style={{ padding: 2 }} aria-label="Remove link"><X size={10} /></button>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ display: "flex", gap: 5, marginBottom: 12 }}>
                  <input value={newLinkLabel} onChange={(e) => setNewLinkLabel(e.target.value)} placeholder="Label" className="tfh-input" style={{ fontSize: 11, flex: "0 0 36%" }} />
                  <input value={newLinkUrl} onChange={(e) => setNewLinkUrl(e.target.value)} placeholder="https://…" className="tfh-input" style={{ fontSize: 11 }} />
                  <button type="button" onClick={addNewLink} className="tfh-btn tfh-btn-ghost" style={{ padding: "3px 7px", flexShrink: 0 }} aria-label="Add link"><Plus size={11} /></button>
                </div>

                <label className="tfh-label" style={{ fontSize: 10 }}>Files</label>
                {newFiles.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 6 }}>
                    {newFiles.map((f, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 7, padding: "4px 7px", borderRadius: 6, background: "var(--raised)" }}>
                        <Paperclip size={11} color="var(--text-faint)" />
                        <span style={{ flex: 1, fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                        <button type="button" onClick={() => removeNewFile(i)} className="tfh-btn tfh-btn-ghost" style={{ padding: 2 }} aria-label="Remove file"><X size={10} /></button>
                      </div>
                    ))}
                  </div>
                )}
                <input ref={newFileInputRef} type="file" multiple style={{ display: "none" }} onChange={(e) => { handleNewFiles(e.target.files); e.target.value = ""; }} />
                <button type="button" onClick={() => newFileInputRef.current?.click()} className="tfh-btn tfh-btn-ghost" style={{ fontSize: 10.5, padding: "3px 7px", marginBottom: 14 }}>
                  <Upload size={10} /> Add file
                </button>

                {error && <div style={{ fontSize: 12, color: "var(--pri-high)", marginBottom: 10 }}>{error}</div>}
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", borderTop: "1px solid var(--line)", paddingTop: 14 }}>
                  <button type="button" className="tfh-btn" onClick={() => { setAdding(false); setNewLinks([]); setNewFiles([]); }}>Cancel</button>
                  <button className="tfh-btn tfh-btn-accent" disabled={creating || !newTitle.trim()}>{creating ? "Adding…" : "Add milestone"}</button>
                </div>
              </form>
            ) : (
              <button className="tfh-btn tfh-btn-accent" onClick={() => setAdding(true)} style={{ alignSelf: "flex-start" }}><Plus size={14} /> Add milestone</button>
            )
          )}
        </div>
      )}

      {canManage && !isComplete && (
        <div className="tfh-card" style={{ padding: 20, borderColor: "var(--pri-high)" }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Mark this project complete</div>
          <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginBottom: 14, lineHeight: 1.5 }}>
            Moves this project to the workspace's history. Nothing is deleted — every task and file stays exactly where it is, just marked done.
          </div>
          {confirmComplete ? (
            <div style={{ display: "flex", gap: 8 }}>
              <button className="tfh-btn" onClick={() => setConfirmComplete(false)}>Cancel</button>
              <button className="tfh-btn" style={{ borderColor: "var(--pri-high)", color: "var(--pri-high)" }} onClick={() => toggleComplete(true)} disabled={completing}>
                {completing ? "Completing…" : "Yes, mark complete"}
              </button>
            </div>
          ) : (
            <button className="tfh-btn" onClick={() => setConfirmComplete(true)}><Check size={14} /> Mark project complete</button>
          )}
        </div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* System performance — real, measured metrics: API round-trip, DB      */
/* query latency, realtime socket status, backend uptime                */
/* ------------------------------------------------------------------ */
const formatUptime = (seconds) => {
  if (seconds < 60) return `${seconds}s`;
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

// Bands are deliberately generous — this app talks to a free-tier Render
// backend and a pooled Supabase connection, where 200-400ms is completely
// normal, not a problem. These thresholds reflect that reality rather
// than numbers borrowed from a dedicated low-latency service.
const speedBand = (ms, fastMax, okMax) => {
  if (ms == null) return { label: "Unreachable", color: "var(--pri-high)", score: 0 };
  if (ms <= fastMax) return { label: "Fast", color: "var(--stage-done)", score: 100 };
  if (ms <= okMax) return { label: "OK", color: "var(--pri-medium)", score: 70 };
  return { label: "Slow", color: "var(--pri-high)", score: 40 };
};

const SystemHealthView = () => {
  const [health, setHealth] = useState(null);
  const [apiRoundTripMs, setApiRoundTripMs] = useState(null);
  const [checkedAt, setCheckedAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const runCheck = async () => {
    setLoading(true);
    setFailed(false);
    const start = performance.now();
    try {
      const data = await api.getHealth();
      setApiRoundTripMs(Math.round(performance.now() - start));
      setHealth(data);
      setCheckedAt(new Date());
    } catch {
      setFailed(true);
      setHealth(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runCheck();
    const interval = setInterval(runCheck, 30000); // refresh every 30s while this tab is open
    return () => clearInterval(interval);
  }, []);

  const apiBand = failed ? speedBand(null, 0, 0) : speedBand(apiRoundTripMs, 300, 800);
  const dbBand = health?.db?.ok ? speedBand(health.db.latencyMs, 50, 200) : speedBand(null, 0, 0);
  const socket = getSocket();
  const realtimeOk = !!socket?.connected;

  const scores = [apiBand.score, dbBand.score, realtimeOk ? 100 : 50];
  const overallPct = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  const overallColor = overallPct >= 85 ? "var(--stage-done)" : overallPct >= 60 ? "var(--pri-medium)" : "var(--pri-high)";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div className="tfh-card" style={{ padding: 28, textAlign: "center" }}>
        <div className="tfh-label" style={{ marginBottom: 10 }}>System Performance</div>
        {loading && !health ? (
          <div style={{ fontSize: 13, color: "var(--text-faint)", padding: "20px 0" }}>Checking…</div>
        ) : (
          <>
            <div style={{ fontSize: 56, fontWeight: 700, color: overallColor, lineHeight: 1 }}>{overallPct}%</div>
            <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginTop: 10 }}>
              {checkedAt ? `Measured just now — checked ${checkedAt.toLocaleTimeString()}, refreshes every 30s` : "Not yet checked"}
            </div>
          </>
        )}
        <button className="tfh-btn tfh-btn-ghost" onClick={runCheck} disabled={loading} style={{ marginTop: 14 }}>
          <RefreshCw size={13} /> {loading ? "Checking…" : "Check now"}
        </button>
      </div>

      <div className="tfh-card" style={{ padding: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14 }}>Live measurements</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 12.5 }}>API response time</div>
              <div style={{ fontSize: 11, color: "var(--text-faint)" }}>Round-trip from your browser, just now</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: apiBand.color }}>{apiBand.label}</div>
              <div className="tfh-mono" style={{ fontSize: 11, color: "var(--text-faint)" }}>{failed ? "—" : `${apiRoundTripMs}ms`}</div>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 12.5 }}>Database</div>
              <div style={{ fontSize: 11, color: "var(--text-faint)" }}>Real query round-trip, timed on the server</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: dbBand.color }}>{health?.db?.ok ? dbBand.label : "Unreachable"}</div>
              <div className="tfh-mono" style={{ fontSize: 11, color: "var(--text-faint)" }}>{health?.db?.ok ? `${health.db.latencyMs}ms` : "—"}</div>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 12.5 }}>Realtime (live updates)</div>
              <div style={{ fontSize: 11, color: "var(--text-faint)" }}>Whether this browser's socket is connected right now</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: realtimeOk ? "var(--stage-done)" : "var(--pri-medium)" }}>{realtimeOk ? "Connected" : "Disconnected"}</div>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 12.5 }}>Backend uptime</div>
              <div style={{ fontSize: 11, color: "var(--text-faint)" }}>Time since the server process last restarted</div>
            </div>
            <div className="tfh-mono" style={{ fontSize: 13, color: "var(--text-dim)" }}>{health ? formatUptime(health.uptimeSeconds) : "—"}</div>
          </div>
        </div>
      </div>

      {failed && (
        <div className="tfh-card" style={{ padding: 16, borderColor: "var(--pri-high)" }}>
          <div style={{ fontSize: 12.5, color: "var(--pri-high)" }}>Couldn't reach the backend just now — this itself is a real signal something's down, not a display bug.</div>
        </div>
      )}
    </div>
  );
};

const AdminPanelView = (props) => {
  const [tab, setTab] = useState("health");

  return (
    <div className="tfh-fade-in" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <Shield size={20} color="var(--accent)" />
          <span className="tfh-display" style={{ fontSize: 26, fontWeight: 600 }}>Admin Panel</span>
        </div>
        <div style={{ fontSize: 13.5, color: "var(--text-dim)" }}>Project performance and team management, in one place — visible only to the admin and team lead.</div>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button className={`tfh-btn ${tab === "health" ? "tfh-btn-accent" : ""}`} onClick={() => setTab("health")}><Shield size={13} /> System Performance</button>
        <button className={`tfh-btn ${tab === "team" ? "tfh-btn-accent" : ""}`} onClick={() => setTab("team")}><Users size={13} /> Team Management</button>
      </div>

      {tab === "health" ? (
        <SystemHealthView />
      ) : (
        <TeamView
          tasks={props.tasks} users={props.users} currentUser={props.currentUser} onOpen={props.onOpen}
          onSetRole={props.onSetRole} onSetTitle={props.onSetTitle} onRemoveMember={props.onRemoveMember}
          onInvite={props.onInvite} canManage={props.canManage} workspaceId={props.workspaceId}
          projects={props.projects} onSetProjectLead={props.onSetProjectLead}
        />
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Workspace switcher (sidebar dropdown) + first-run creation screen     */
/* ------------------------------------------------------------------ */
const WorkspaceSwitcher = () => {
  const { workspaces, current, switchTo } = useWorkspace();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Only one workspace ever exists in normal use, so there's nothing to
  // switch between — just show the name, no dropdown chrome at all.
  if (workspaces.length <= 1) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "6px" }}>
        <Logo size={32} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="tfh-display" style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{current?.name || "Flow Hub"}</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: "relative" }} ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ display: "flex", alignItems: "center", gap: 9, padding: "6px", borderRadius: 10, border: "none", background: "transparent", width: "100%", textAlign: "left" }}
      >
        <Logo size={32} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="tfh-display" style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{current?.name || "Flow Hub"}</div>
        </div>
        <ChevronDown size={14} color="var(--text-faint)" />
      </button>

      {open && (
        <div className="tfh-card tfh-fade-in" style={{ position: "absolute", left: 0, top: 46, width: 260, zIndex: 30, padding: 8 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 220, overflowY: "auto" }}>
            {workspaces.map((w) => (
              <button
                key={w.id}
                onClick={() => { switchTo(w.id); setOpen(false); }}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 9px", borderRadius: 8, border: "none", background: w.id === current?.id ? "var(--accent-soft)" : "transparent", color: "var(--text)", textAlign: "left" }}
              >
                <Building2 size={13} color={w.id === current?.id ? "var(--accent)" : "var(--text-faint)"} />
                <span style={{ flex: 1, fontSize: 12.5, fontWeight: w.id === current?.id ? 600 : 500 }}>{w.name}</span>
                {w.role === "admin" && <Shield size={11} color="var(--stage-done)" />}
                {w.role === "lead" && <Crown size={11} color="var(--accent)" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const CreateWorkspaceScreen = () => {
  const { create, refresh } = useWorkspace();
  const { user, logout } = useAuth();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError("");
    try {
      await create(name.trim());
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const checkAgain = async () => {
    setRefreshing(true);
    try { await refresh(); } finally { setRefreshing(false); }
  };

  if (!user.isPlatformAdmin) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <div className="tfh-card tfh-fade-in" style={{ width: "100%", maxWidth: 420, padding: 30, textAlign: "center" }}>
          <Logo size={44} />
          <div className="tfh-display" style={{ fontSize: 20, fontWeight: 600, margin: "16px 0 6px" }}>You're not on a workspace yet</div>
          <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 22, lineHeight: 1.5 }}>
            Your account is ready, but you haven't been added to a workspace yet. Ask your administrator to invite <strong>{user.email}</strong>, then check again.
          </div>
          <button onClick={checkAgain} className="tfh-btn tfh-btn-accent" style={{ width: "100%", justifyContent: "center", marginBottom: 10 }} disabled={refreshing}>
            {refreshing ? "Checking…" : "Check again"}
          </button>
          <button onClick={logout} className="tfh-btn tfh-btn-ghost" style={{ width: "100%", justifyContent: "center", fontSize: 12.5 }}>
            <LogOut size={13} /> Sign out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div className="tfh-card tfh-fade-in" style={{ width: "100%", maxWidth: 420, padding: 30 }}>
        <Logo size={44} />
        <div style={{ height: 14 }} />
        <div className="tfh-display" style={{ fontSize: 22, fontWeight: 600, marginBottom: 6 }}>Create your first workspace</div>
        <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 22, lineHeight: 1.5 }}>
          A workspace is its own board, team, and task history. Staff won't see this screen — you invite them in afterwards from the Team page.
        </div>
        <form onSubmit={submit}>
          <label className="tfh-label" htmlFor="ws-name">Workspace name</label>
          <input id="ws-name" autoFocus className="tfh-input" placeholder="e.g. Product Team" value={name} onChange={(e) => setName(e.target.value)} style={{ marginBottom: 16 }} />
          {error && <div style={{ fontSize: 12.5, color: "var(--pri-high)", marginBottom: 14 }}>{error}</div>}
          <button className="tfh-btn tfh-btn-accent" style={{ width: "100%", padding: "10px 14px" }} disabled={busy || !name.trim()}>
            {busy ? "Creating…" : "Create workspace"}
          </button>
        </form>
        <button onClick={logout} className="tfh-btn tfh-btn-ghost" style={{ width: "100%", justifyContent: "center", marginTop: 10, fontSize: 12.5 }}>
          <LogOut size={13} /> Sign out
        </button>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Project switcher + first-run project creation screen                  */
/* ------------------------------------------------------------------ */
// The one project-navigation control in the sidebar — sets both the
// Board's project filter and the "current project" that Milestones/Files
// pages need, so clicking a project here is the single way to move
// between projects (previously this and a separate switcher dropdown
// overlapped; consolidated into just this one).
const ProjectsSidebarList = ({ projects, activeFilter, onSelectProject, canManage, onCreateProject }) => {
  const [showCompleted, setShowCompleted] = useState(false);
  const active = projects.filter((p) => !p.completedAt);
  const completed = projects.filter((p) => p.completedAt);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: 0.5, padding: "0 10px", marginBottom: 4 }}>Projects</div>
      <button
        onClick={() => onSelectProject("all")}
        className={`tfh-nav-item ${activeFilter === "all" ? "active" : ""}`}
        style={{ fontSize: 12.5, padding: "7px 10px" }}
      >
        <FolderKanban size={13} /> All projects
      </button>
      {active.map((p) => (
        <button
          key={p.id} onClick={() => onSelectProject(p.id)}
          className={`tfh-nav-item ${activeFilter === p.id ? "active" : ""}`}
          style={{ fontSize: 12.5, padding: "7px 10px" }}
          title={p.name}
        >
          <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--stage-progress)", flexShrink: 0 }} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
        </button>
      ))}
      {completed.length > 0 && (
        <>
          <button
            onClick={() => setShowCompleted((s) => !s)}
            style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-faint)", background: "none", border: "none", padding: "6px 10px", cursor: "pointer" }}
          >
            {showCompleted ? <ChevronUp size={11} /> : <ChevronDown size={11} />} Completed ({completed.length})
          </button>
          {showCompleted && completed.map((p) => (
            <button
              key={p.id} onClick={() => onSelectProject(p.id)}
              className={`tfh-nav-item ${activeFilter === p.id ? "active" : ""}`}
              style={{ fontSize: 12.5, padding: "7px 10px", opacity: 0.75 }}
              title={p.name}
            >
              <CheckCircle2 size={12} color="var(--accent)" style={{ flexShrink: 0 }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: "line-through" }}>{p.name}</span>
            </button>
          ))}
        </>
      )}
      {canManage && (
        <div style={{ padding: "6px 10px 0" }}>
          <NewProjectButton onCreateProject={onCreateProject} />
        </div>
      )}
    </div>
  );
};


const CreateProjectScreen = ({ canManage, onCreate, workspaceName, logout }) => {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [deadline, setDeadline] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError("");
    try {
      await onCreate(name.trim(), description.trim(), deadline || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!canManage) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <div className="tfh-card tfh-fade-in" style={{ width: "100%", maxWidth: 420, padding: 30, textAlign: "center" }}>
          <Logo size={44} />
          <div className="tfh-display" style={{ fontSize: 20, fontWeight: 600, margin: "16px 0 6px" }}>No projects yet</div>
          <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 20, lineHeight: 1.5 }}>
            <strong>{workspaceName}</strong> doesn't have any projects set up. Ask your admin or team lead to create one — you'll see it here as soon as they do.
          </div>
          <button onClick={logout} className="tfh-btn tfh-btn-ghost" style={{ width: "100%", justifyContent: "center", fontSize: 12.5 }}>
            <LogOut size={13} /> Sign out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div className="tfh-card tfh-fade-in" style={{ width: "100%", maxWidth: 440, padding: 30 }}>
        <Logo size={44} />
        <div style={{ height: 14 }} />
        <div className="tfh-display" style={{ fontSize: 22, fontWeight: 600, marginBottom: 6 }}>Create your first project</div>
        <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 22, lineHeight: 1.5 }}>
          Projects keep tasks segregated inside <strong>{workspaceName}</strong> — each one gets its own board, subtasks, and history.
        </div>
        <form onSubmit={submit}>
          <label className="tfh-label" htmlFor="proj-name">Project name</label>
          <input id="proj-name" autoFocus className="tfh-input" placeholder="e.g. Website Relaunch" value={name} onChange={(e) => setName(e.target.value)} style={{ marginBottom: 14 }} />
          <label className="tfh-label" htmlFor="proj-desc">Description (optional)</label>
          <textarea id="proj-desc" className="tfh-input" rows={2} placeholder="What is this project about?" value={description} onChange={(e) => setDescription(e.target.value)} style={{ marginBottom: 14, resize: "vertical" }} />
          <label className="tfh-label" htmlFor="proj-deadline">Deadline <span style={{ textTransform: "none", fontWeight: 400 }}>(optional)</span></label>
          <input id="proj-deadline" type="date" className="tfh-input" value={deadline} onChange={(e) => setDeadline(e.target.value)} style={{ marginBottom: 16 }} />
          {error && <div style={{ fontSize: 12.5, color: "var(--pri-high)", marginBottom: 14 }}>{error}</div>}
          <button className="tfh-btn tfh-btn-accent" style={{ width: "100%", padding: "10px 14px" }} disabled={busy || !name.trim()}>
            {busy ? "Creating…" : "Create project"}
          </button>
        </form>
      </div>
    </div>
  );
};

const EditProfileModal = ({ member, currentUser, workspaceId, onClose, onProfileUpdated, onMembersUpdated }) => {
  const [name, setName] = useState(currentUser.name);
  const [title, setTitle] = useState(member?.title || "");
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  const handleAvatarFile = async (files) => {
    const file = files?.[0];
    if (!file) return;
    setAvatarBusy(true);
    setError("");
    try {
      const { user } = await api.uploadAvatar(file);
      invalidateAvatarCache(user.id);
      onProfileUpdated(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setAvatarBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const save = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError("");
    try {
      if (name.trim() !== currentUser.name) {
        const { user } = await api.updateProfile(name.trim());
        onProfileUpdated(user);
      }
      if (workspaceId && title.trim() && title.trim() !== member?.title) {
        const { members } = await api.setMemberTitle(workspaceId, currentUser.id, title.trim());
        onMembersUpdated(members);
      }
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="tfh-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="tfh-card tfh-modal-card" style={{ width: "100%", maxWidth: 420, padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <span className="tfh-display" style={{ fontSize: 19, fontWeight: 600 }}>Edit profile</span>
          <button className="tfh-btn tfh-btn-ghost" style={{ padding: 6 }} onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>

        <div style={{ display: "flex", justifyContent: "center", marginBottom: 22 }}>
          <button
            type="button" onClick={() => inputRef.current?.click()} disabled={avatarBusy}
            style={{ position: "relative", border: "none", background: "none", padding: 0, cursor: "pointer" }}
            title="Change photo"
          >
            <Avatar member={member || currentUser} size={76} />
            <div style={{ position: "absolute", bottom: 0, right: 0, width: 26, height: 26, borderRadius: 999, background: "var(--accent)", border: "3px solid var(--panel)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {avatarBusy ? <Loader2 size={13} color="#12141c" className="tfh-pulse" /> : <Pencil size={13} color="#12141c" />}
            </div>
            <input ref={inputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => handleAvatarFile(e.target.files)} />
          </button>
        </div>

        <form onSubmit={save}>
          <label className="tfh-label" htmlFor="profile-name">Name</label>
          <input id="profile-name" className="tfh-input" value={name} onChange={(e) => setName(e.target.value)} style={{ marginBottom: 14 }} />

          {workspaceId && (
            <>
              <label className="tfh-label" htmlFor="profile-title">Post / designation</label>
              <input id="profile-title" list="profile-post-suggestions" className="tfh-input" placeholder="e.g. Product Designer" value={title} onChange={(e) => setTitle(e.target.value)} style={{ marginBottom: 16 }} />
              <datalist id="profile-post-suggestions">
                {POST_SUGGESTIONS.map((p) => <option key={p} value={p} />)}
              </datalist>
            </>
          )}

          {error && <div style={{ fontSize: 12.5, color: "var(--pri-high)", marginBottom: 14 }}>{error}</div>}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, borderTop: "1px solid var(--line)", paddingTop: 16 }}>
            <button type="button" className="tfh-btn" onClick={onClose}>Cancel</button>
            <button className="tfh-btn tfh-btn-accent" disabled={saving || !name.trim()}>{saving ? "Saving…" : "Save changes"}</button>
          </div>
        </form>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Workspace shell                                                       */
/* ------------------------------------------------------------------ */
function Workspace() {
  const { user, logout, setUser } = useAuth();
  const { theme, toggle } = useTheme();
  const { current, currentId, loading: workspaceLoading } = useWorkspace();
  const { projects, current: currentProject, currentId: projectId, loading: projectsLoading, create: createProject, refresh: refreshProjects, switchTo: switchProject } = useProject();

  const [tasks, setTasks] = useState([]);
  const [users, setUsers] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setViewRaw] = useState(() => localStorage.getItem("tfh_view") || "dashboard");
  const setView = (v) => { setViewRaw(v); localStorage.setItem("tfh_view", v); };
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [permission, setPermission] = useState(typeof Notification !== "undefined" ? Notification.permission : "denied");

  const [search, setSearch] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState(projectId || "all");
  // Switching projects in the sidebar re-focuses the Board on that project
  // too — but once there, the Board's own dropdown can freely deviate from
  // it (e.g. to "All projects") without fighting the sidebar for control.
  useEffect(() => { setProjectFilter(projectId || "all"); }, [projectId]);
  const [draft, setDraft] = useState(null);
  const [bulkAddOpen, setBulkAddOpen] = useState(false);
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [uploadPhase, setUploadPhase] = useState(false);

  const currentUser = useMemo(() => users.find((u) => u.id === user.id) || { ...user, role: "member" }, [users, user]);
  const canManage = currentUser.role === "admin" || currentUser.role === "lead";
  // Project-scoped authority: workspace admin/lead, OR this specific
  // project's own assigned lead. Deliberately NOT used for workspace-level
  // things (Team invites/roles, holidays) — only for actions scoped to the
  // currently open project (tasks, milestones, files, project links).
  const canManageProject = canManage || currentProject?.leadId === user.id;

  const loadAll = async (workspaceId) => {
    setLoading(true);
    const [membersRes, notifRes, tasksRes] = await Promise.all([api.getMembers(workspaceId), api.getNotifications(), api.getAllTasks(workspaceId)]);
    setUsers(membersRes.members);
    setNotifications(notifRes.notifications);
    setTasks(tasksRes.tasks);
    setLoading(false);
  };

  useEffect(() => {
    if (currentId && !projectsLoading) loadAll(currentId);
  }, [currentId, projectsLoading]);
  useEffect(() => { if (view === "admin" && !canManage) setView("dashboard"); }, [view, canManage]);
  // If there's no project (or the current one disappears), only the
  // Dashboard, Board, and Team views make sense — everything else needs a
  // specific project. Board now works without one selected (workspace-wide).
  useEffect(() => { if (!projectId && view !== "dashboard" && view !== "team" && view !== "activity" && view !== "board") setView("dashboard"); }, [projectId, view]);

  // Realtime: socket listeners, scoped to the workspace currently being viewed
  useEffect(() => {
    const socket = connectSocket() || getSocket();
    if (!socket || !currentId) return;

    const onNotification = (notif) => {
      setNotifications((prev) => [notif, ...prev]);
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        new Notification("Team Flow Hub", { body: notif.message });
      }
    };
    const onTaskChanged = (payload) => {
      if (payload?.workspaceId && payload.workspaceId !== currentId) return;
      api.getAllTasks(currentId).then((r) => setTasks(r.tasks));
    };
    const onLeadChanged = (payload) => {
      if (payload?.workspaceId && payload.workspaceId !== currentId) return;
      api.getMembers(currentId).then((r) => setUsers(r.members));
    };
    const onMembersChanged = (payload) => {
      if (payload?.workspaceId && payload.workspaceId !== currentId) return;
      api.getMembers(currentId).then((r) => setUsers(r.members));
    };

    socket.on("notification:new", onNotification);
    socket.on("task:changed", onTaskChanged);
    socket.on("lead:changed", onLeadChanged);
    socket.on("members:changed", onMembersChanged);

    return () => {
      socket.off("notification:new", onNotification);
      socket.off("task:changed", onTaskChanged);
      socket.off("lead:changed", onLeadChanged);
      socket.off("members:changed", onMembersChanged);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, currentId, projectId, canManage]);

  const requestPermission = async () => {
    if (typeof Notification === "undefined") return;
    const result = await Notification.requestPermission();
    setPermission(result);
  };

  const openCreate = (status = "todo") => { setDraft(emptyDraft(status, users, user.id, projectId)); setSaveError(""); };
  const openEdit = (task) => { setDraft({ ...task, subtasks: task.subtasks.map((s) => ({ ...s })) }); setSaveError(""); };
  const openEditById = (id) => { const t = tasks.find((x) => x.id === id); if (t) openEdit(t); };
  const closeDialog = () => { setDraft(null); setSaveError(""); };

  const saveDraft = async () => {
    if (!draft.title.trim()) return;
    if (!draft.projectId) { setSaveError("Choose which project this task belongs to."); return; }
    setSaving(true);
    setSaveError("");
    setUploadPhase(false);
    try {
      // pendingLinks/pendingFiles are client-only scratch state (File objects
      // aren't JSON-serializable) — strip them before sending the subtasks
      // payload, then use the original draft.subtasks (which still has them)
      // to fire the actual uploads once each subtask has a real id.
      const cleanSubtasks = draft.subtasks.map(({ pendingLinks, pendingFiles, ...s }) => s);
      const taskProjectId = draft.projectId;
      let savedTask;
      let taskId;

      if (draft.id) {
        // Managers can change everything, including who it's assigned to.
        // A plain member editing their OWN task gets the same full patch
        // minus assigneeId — reassigning stays manager-only even then.
        // Anyone else shouldn't reach this path at all (fields are locked
        // client-side and the server rejects it regardless).
        const isOwnTask = draft.assigneeId === user.id;
        const patch = canManage
          ? { title: draft.title, description: draft.description, status: draft.status, priority: draft.priority, assigneeId: draft.assigneeId, due: draft.due, dueTime: draft.dueTime || null }
          : isOwnTask
            ? { title: draft.title, description: draft.description, status: draft.status, priority: draft.priority, due: draft.due, dueTime: draft.dueTime || null }
            : { status: draft.status };
        await api.updateTask(currentId, taskProjectId, draft.id, patch);
        const { task } = await api.setSubtasks(currentId, taskProjectId, draft.id, cleanSubtasks);
        savedTask = task;
        taskId = draft.id;
      } else {
        // links go straight in the JSON payload (they're just text, created
        // atomically with the task server-side); pendingFiles can't — those
        // upload as a real follow-up request right below, once the task has
        // an id to attach to.
        const { title, description, status, priority, assigneeId, due, dueTime } = draft;
        const { task } = await api.createTask(currentId, taskProjectId, {
          title, description, status, priority, assigneeId, due, dueTime,
          subtasks: cleanSubtasks, links: draft.pendingLinks,
        });
        savedTask = task;
        taskId = task.id;
      }

      // From here on the task itself is safely saved — a failed file upload
      // below should never look like the whole save failed, and should
      // never trigger a duplicate task on retry. Track each job with a label
      // so a partial failure can name exactly what didn't make it.
      const uploadJobs = [];
      draft.subtasks.forEach((s, i) => {
        const real = savedTask.subtasks[i];
        if (!real) return;
        (s.pendingLinks || []).forEach((l) => uploadJobs.push({ label: `link "${l.label}" on "${s.text}"`, run: () => api.addSubtaskLink(currentId, taskProjectId, taskId, real.id, l.label, l.url) }));
        (s.pendingFiles || []).forEach((f) => uploadJobs.push({ label: `file "${f.name}" on "${s.text}"`, run: () => api.uploadSubtaskAttachment(currentId, taskProjectId, taskId, real.id, f) }));
      });
      if (!draft.id) {
        draft.pendingFiles.forEach((f) => uploadJobs.push({ label: `file "${f.name}"`, run: () => api.uploadAttachment(currentId, taskProjectId, taskId, f) }));
      }

      if (uploadJobs.length > 0) {
        setUploadPhase(true);
        const results = await Promise.allSettled(uploadJobs.map((j) => j.run()));
        const failed = results.map((r, i) => (r.status === "rejected" ? uploadJobs[i].label : null)).filter(Boolean);
        const { tasks: refreshed } = await api.getAllTasks(currentId);
        setTasks(refreshed);
        if (failed.length > 0) {
          // The task and everything else saved fine — only surface what
          // genuinely didn't make it, and keep the dialog open so nothing
          // staged gets silently lost.
          setSaveError(`Saved, but ${failed.length === 1 ? "this didn't" : "these didn't"} upload: ${failed.join(", ")}. You can try adding ${failed.length === 1 ? "it" : "them"} again below.`);
          return;
        }
      } else if (draft.id) {
        setTasks((prev) => prev.map((t) => (t.id === savedTask.id ? savedTask : t)));
      } else {
        setTasks((prev) => [...prev, savedTask]);
      }

      setDraft(null);
    } catch (err) {
      setSaveError(err.message || "Something went wrong saving this task. Please try again.");
    } finally {
      setSaving(false);
      setUploadPhase(false);
    }
  };

  const deleteTask = async (id) => {
    await api.deleteTask(currentId, draft.projectId, id);
    setTasks((prev) => prev.filter((t) => t.id !== id));
    setDraft(null);
  };

  const bulkAddTasks = async ({ tasks, due, priority }) => {
    const { tasks: created } = await api.createTasksBulk(currentId, projectId, { tasks, due, priority });
    setTasks((prev) => [...prev, ...created]);
  };

  const moveTask = async (id, status) => {
    const target = tasks.find((t) => t.id === id);
    if (!target) return;
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status } : t))); // optimistic
    const { task } = await api.updateTask(currentId, target.projectId, id, { status });
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...task } : t)));
  };
  const completeTask = (id) => moveTask(id, "done");
  const reopenTask = (id) => moveTask(id, "todo");

  const setRole = async (userId, role) => {
    const { members } = await api.setMemberRole(currentId, userId, role);
    setUsers(members);
  };

  const setProjectLeadFor = async (pid, leadId) => {
    await api.setProjectLead(currentId, pid, leadId);
    await refreshProjects();
  };

  const setTitle = async (userId, title) => {
    const { members } = await api.setMemberTitle(currentId, userId, title);
    setUsers(members);
  };

  const removeMember = async (userId) => {
    const { members } = await api.removeMember(currentId, userId);
    setUsers(members);
  };

  const invite = async (email) => {
    const result = await api.inviteToWorkspace(currentId, email);
    if (result.members) setUsers(result.members); // existing user added immediately — reflect it now, not after a refresh
    return result;
  };

  const markRead = async (id) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    await api.markNotificationRead(id);
  };
  const markAllRead = async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    await api.markAllRead();
  };

  if (workspaceLoading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
        <Spinner /> <span style={{ fontSize: 13, color: "var(--text-dim)" }}>Loading your account…</span>
      </div>
    );
  }

  if (!currentId) {
    return <CreateWorkspaceScreen />;
  }

  if (loading || projectsLoading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
        <Spinner /> <span style={{ fontSize: 13, color: "var(--text-dim)" }}>Loading {current?.name || "workspace"}…</span>
      </div>
    );
  }

  if (!projectId && !canManage) {
    return <CreateProjectScreen canManage={canManage} onCreate={createProject} workspaceName={current?.name} logout={logout} />;
  }

  const visibleNav = (canManage ? NAV : NAV.filter((n) => n.id !== "admin"))
    .filter((n) => projectId || n.id === "dashboard" || n.id === "team" || n.id === "activity" || n.id === "board");

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      {/* Sidebar */}
      <div className={`tfh-sidebar ${mobileNavOpen ? "open" : ""}`} style={{ width: 216, borderRight: "1px solid var(--line)", padding: "20px 14px", display: "flex", flexDirection: "column", gap: 22, background: "var(--ink)" }}>
        <WorkspaceSwitcher />
        <ProjectsSidebarList
          projects={projects}
          activeFilter={projectFilter}
          canManage={canManage}
          onCreateProject={createProject}
          onSelectProject={(id) => {
            setProjectFilter(id);
            if (id !== "all") switchProject(id); // also sets the "current project" Milestones/Files depend on
            setView("board");
            setMobileNavOpen(false);
          }}
        />

        <nav style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {visibleNav.map((n) => (
            <button key={n.id} className={`tfh-nav-item ${view === n.id ? "active" : ""}`} onClick={() => { setView(n.id); setMobileNavOpen(false); }}>
              <n.icon size={16} /> {n.label}
            </button>
          ))}
        </nav>

        <div style={{ marginTop: "auto", padding: 12, borderRadius: 12, background: "var(--panel)", border: "1px solid var(--line)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <button type="button" onClick={() => setEditProfileOpen(true)} style={{ display: "flex", alignItems: "center", gap: 9, flex: 1, minWidth: 0, background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }} title="Edit profile">
              <Avatar member={currentUser} size={30} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{currentUser.name}</div>
                <div style={{ fontSize: 11, color: "var(--text-faint)" }}>{currentUser.title}</div>
              </div>
            </button>
            <button className="tfh-btn tfh-btn-ghost" style={{ padding: 6 }} onClick={logout} aria-label="Sign out"><LogOut size={14} /></button>
          </div>
        </div>
      </div>

      {editProfileOpen && (
        <EditProfileModal
          member={currentUser}
          currentUser={user}
          workspaceId={currentId}
          onClose={() => setEditProfileOpen(false)}
          onProfileUpdated={async (updatedUser) => {
            setUser(updatedUser);
            invalidateAvatarCache(updatedUser.id);
            if (currentId) {
              const { members } = await api.getMembers(currentId);
              setUsers(members);
            }
          }}
          onMembersUpdated={setUsers}
        />
      )}

      {/* Main */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 24px", borderBottom: "1px solid var(--line)" }}>
          <button className="tfh-btn tfh-btn-ghost tfh-show-mobile-only" onClick={() => setMobileNavOpen(true)} aria-label="Open menu"><Menu size={16} /></button>
          <span className="tfh-mono" style={{ fontSize: 11, color: "var(--text-faint)" }}>
            {new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
          </span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            <button className="tfh-btn" onClick={() => openCreate("todo")}><Plus size={14} /> Quick add</button>
            <NotificationBell
              notifications={notifications} onOpenTask={openEditById}
              onMarkRead={markRead} onMarkAll={markAllRead}
              permission={permission} onRequestPermission={requestPermission}
            />
            <button className="tfh-btn tfh-btn-ghost" style={{ padding: 8 }} onClick={toggle} aria-label="Toggle theme">
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>
        </div>

        <div style={{ padding: 24, flex: 1, overflowY: "auto" }}>
          {view === "dashboard" && <DashboardView workspaceId={currentId} tasks={tasks} users={users} currentUser={currentUser} onOpen={openEdit} onOpenFiltered={(filterId) => { setStatusFilter(filterId); setView("board"); }} hasProject={!!projectId} onCreateProject={createProject} />}
          {view === "board" && (
            <BoardView
              tasks={tasks} users={users} projects={projects} onOpen={openEdit} onComplete={completeTask} onReopen={reopenTask} onAdd={openCreate} onBulkAdd={() => setBulkAddOpen(true)} onCreateProject={createProject} canManage={canManage} currentUserId={user.id}
              search={search} setSearch={setSearch}
              priorityFilter={priorityFilter} setPriorityFilter={setPriorityFilter}
              assigneeFilter={assigneeFilter} setAssigneeFilter={setAssigneeFilter}
              statusFilter={statusFilter} setStatusFilter={setStatusFilter}
              projectFilter={projectFilter} setProjectFilter={setProjectFilter}
            />
          )}
          {view === "team" && <TeamView tasks={tasks} users={users} currentUser={currentUser} onOpen={openEdit} onSetRole={setRole} onSetTitle={setTitle} onRemoveMember={removeMember} onInvite={invite} canManage={canManage} workspaceId={currentId} projects={projects} onSetProjectLead={setProjectLeadFor} />}
          {view === "activity" && <ActivityLogView workspaceId={currentId} currentUser={currentUser} canManage={canManage} projects={projects} />}
          {view === "calendar" && <CalendarView tasks={tasks} users={users} onOpen={openEdit} workspaceId={currentId} canManage={canManage} />}
          {view === "files" && <DocumentsView workspaceId={currentId} projectId={projectId} projectName={currentProject?.name} canManage={canManageProject} />}
          {view === "milestones" && (
            <MilestonesView workspaceId={currentId} projectId={projectId} project={currentProject} canManage={canManageProject} isAdmin={currentUser.role === "admin"} users={users} onProjectUpdated={() => refreshProjects()} />
          )}
          {view === "admin" && canManage && (
            <AdminPanelView
              users={users} currentUser={currentUser}
              tasks={tasks} projects={projects} onOpen={openEdit}
              onSetRole={setRole} onSetTitle={setTitle} onRemoveMember={removeMember} onInvite={invite}
              canManage={canManage} workspaceId={currentId} onSetProjectLead={setProjectLeadFor}
            />
          )}
        </div>
      </div>

      {draft && <TaskDialog draft={draft} setDraft={setDraft} users={users} projects={projects} onClose={closeDialog} onSave={saveDraft} onDelete={deleteTask} saving={saving} saveError={saveError} uploadPhase={uploadPhase} isWorkspaceManager={canManage} workspaceId={currentId} currentUserId={user.id} />}
      {bulkAddOpen && <BulkAddModal users={users} currentUserId={user.id} onClose={() => setBulkAddOpen(false)} onSubmit={bulkAddTasks} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Root app: auth gate + routes                                          */
/* ------------------------------------------------------------------ */
export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Spinner />
      </div>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/*" element={<Workspace />} />
    </Routes>
  );
}