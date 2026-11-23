// hooks/useSocket.js — Socket.IO connection with auto-reconnect
import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';

let globalSocket = null;
let socketRefCount = 0;

function getSocket() {
  if (!globalSocket) {
    // Same origin as the Vite app; /socket.io is proxied to the API server.
    globalSocket = io({
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity,
    });
  }
  return globalSocket;
}

/**
 * useSocket — Subscribe to Socket.IO events.
 * Returns { connected, socket }.
 * Multiple components share the same underlying socket connection.
 */
export function useSocket() {
  const [connected, setConnected] = useState(false);
  const socketRef = useRef(null);

  useEffect(() => {
    const socket = getSocket();
    socketRef.current = socket;
    socketRefCount++;

    setConnected(socket.connected);

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socketRefCount--;
    };
  }, []);

  const on = useCallback((event, handler) => {
    const socket = getSocket();
    socket.on(event, handler);
    return () => socket.off(event, handler);
  }, []);

  return { connected, on, socket: socketRef.current };
}
