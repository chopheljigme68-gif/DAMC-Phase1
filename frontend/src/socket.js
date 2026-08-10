import { io } from "socket.io-client";
import { api } from "./api";

let socket = null;

export function connectSocket() {
  if (socket) return socket;
  const token = api.getToken();
  if (!token) return null;
  socket = io(api.API_URL, {
    auth: { token },
    transports: ["websocket", "polling"],
  });
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function getSocket() {
  return socket;
}
