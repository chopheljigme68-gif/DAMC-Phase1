import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "../api";
import { connectSocket, disconnectSocket } from "../socket";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const bootstrap = useCallback(async () => {
    const token = api.getToken();
    if (!token) { setLoading(false); return; }
    try {
      const { user } = await api.me();
      setUser(user);
      connectSocket();
    } catch {
      api.setToken(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { bootstrap(); }, [bootstrap]);

  const login = async (email, password) => {
    const { token, user } = await api.login({ email, password });
    api.setToken(token);
    setUser(user);
    connectSocket();
  };

  const register = async (name, email, password, title) => {
    const { token, user } = await api.register({ name, email, password, title });
    api.setToken(token);
    setUser(user);
    connectSocket();
  };

  const logout = () => {
    api.setToken(null);
    localStorage.removeItem("tfh_workspace_id");
    localStorage.removeItem("tfh_project_id");
    localStorage.removeItem("tfh_view");
    disconnectSocket();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, setUser, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
