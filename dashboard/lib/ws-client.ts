"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import type { WsEvent, WsEventType } from "./types";

const WS_URL = "ws://localhost:3001";

type EventCallback<T = unknown> = (payload: T) => void;
const listeners = new Map<WsEventType, Set<EventCallback>>();

let socketRef: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function getOrCreateSocket(): WebSocket {
  if (socketRef && socketRef.readyState === WebSocket.OPEN) return socketRef;
  if (socketRef && socketRef.readyState === WebSocket.CONNECTING) return socketRef;

  const ws = new WebSocket(WS_URL);
  socketRef = ws;

  ws.onmessage = (ev) => {
    try {
      const event = JSON.parse(ev.data as string) as WsEvent;
      const handlers = listeners.get(event.type);
      if (handlers) {
        for (const handler of handlers) {
          handler(event.payload);
        }
      }
    } catch {
      // ignore malformed messages
    }
  };

  ws.onclose = () => {
    socketRef = null;
    reconnectTimer = setTimeout(() => getOrCreateSocket(), 2000);
  };

  ws.onerror = () => {
    ws.close();
  };

  return ws;
}

export function onEvent<T = unknown>(
  type: WsEventType,
  callback: EventCallback<T>
): () => void {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type)!.add(callback as EventCallback);

  // Ensure socket is alive
  if (typeof window !== "undefined") getOrCreateSocket();

  return () => {
    listeners.get(type)?.delete(callback as EventCallback);
  };
}

export function useWsClient() {
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WsEvent | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const ws = getOrCreateSocket();
    wsRef.current = ws;

    const checkState = () => setIsConnected(ws.readyState === WebSocket.OPEN);
    ws.addEventListener("open", checkState);
    ws.addEventListener("close", checkState);

    const unsub = onEvent("payment:update", (payload) => {
      setLastMessage({ type: "payment:update", payload, timestamp: Date.now() });
    });

    return () => {
      ws.removeEventListener("open", checkState);
      ws.removeEventListener("close", checkState);
      unsub();
    };
  }, []);

  const send = useCallback((data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  return { lastMessage, isConnected, send };
}
