import { io } from "socket.io-client";
import { api } from "./api";

let socket = null;

export function connectSocket() {
  if (socket) return socket;
  const token = api.getToken();
  if (!token) return null;
  socket = io(api.API_URL, {
    // A function, not a fixed object: it is read again on every reconnect,
    // so after a password change (which replaces the token and signs out the
    // old one) the live connection comes back with the NEW token instead of
    // being refused and quietly going dead.
    auth: (cb) => cb({ token: api.getToken() }),
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
