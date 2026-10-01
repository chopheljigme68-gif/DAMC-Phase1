import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api } from "../api";
import { getSocket } from "../socket";
import { useAuth } from "./AuthContext.jsx";

const WorkspaceContext = createContext(null);

export function WorkspaceProvider({ children }) {
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id || null;
  const [workspaces, setWorkspaces] = useState([]);
  const [currentId, setCurrentId] = useState(() => localStorage.getItem("tfh_workspace_id") || null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { workspaces } = await api.getWorkspaces();
    setWorkspaces(workspaces);
    setCurrentId((prev) => {
      if (prev && workspaces.some((w) => w.id === prev)) return prev;
      return workspaces[0]?.id || null;
    });
    return workspaces;
  }, []);

  useEffect(() => {
    // Auth itself hasn't resolved yet — don't decide anything based on a
    // momentarily-null user, or we'll flash "no workspace" on every refresh
    // before the real session/role data has even loaded.
    if (authLoading) return;
    if (!userId) { setWorkspaces([]); setCurrentId(null); setLoading(false); return; }
    setLoading(true);
    refresh().finally(() => setLoading(false));
    // Keyed on WHO is signed in, not on the user object. The object is
    // replaced whenever anything about the person changes — their name, their
    // photo, their appearance — and depending on it meant every one of those
    // reloaded the entire workspace behind a spinner, unmounting whatever was
    // open (the profile dialog, the appearance panel). Only a different
    // person needs a different set of workspaces.
  }, [userId, authLoading, refresh]);

  useEffect(() => {
    if (currentId) localStorage.setItem("tfh_workspace_id", currentId);
    else localStorage.removeItem("tfh_workspace_id");
  }, [currentId]);

  const switchTo = (id) => setCurrentId(id);

  const create = async (name) => {
    const { workspace } = await api.createWorkspace(name);
    await refresh();
    setCurrentId(workspace.id);
    const socket = getSocket();
    if (socket) socket.emit("workspace:join", workspace.id);
    return workspace;
  };

  const current = workspaces.find((w) => w.id === currentId) || null;

  return (
    <WorkspaceContext.Provider value={{ workspaces, current, currentId, loading, switchTo, create, refresh }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export const useWorkspace = () => useContext(WorkspaceContext);