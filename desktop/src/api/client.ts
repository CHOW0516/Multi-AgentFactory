// REST + WebSocket client used by every page (owned by P1).
//
//   apiFetch<T>("/orders")                       GET /api/orders with the JWT
//   apiFetch<T>("/orders/upload", { method: "POST", body: formData })
//   useLiveEvents(["machine_status_changed"], (event) => ...)
//   registerMock("GET", "/orders/:id", ({ params }) => ...)   inside any src/**/mocks.ts
//
// With VITE_USE_MOCKS=true every request is answered by a registered mock (404 if none),
// and emitMockEvent() feeds useLiveEvents instead of the real WebSocket.

import { QueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useAuthStore } from "../shell/auth-store";
import type { LiveEvent, LiveEventType } from "./types";

export const API_BASE_URL: string = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:8000";
export const WS_URL: string = (import.meta.env.VITE_WS_URL as string | undefined) ?? "ws://localhost:8000/ws";
export const USE_MOCKS: boolean = import.meta.env.VITE_USE_MOCKS === "true";

export class ApiError extends Error {
  constructor(public status: number, public detail: unknown) {
    super(typeof detail === "string" ? detail : `Request failed with status ${status}`);
  }
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => !(error instanceof ApiError && error.status < 500) && failureCount < 2,
      staleTime: 15_000,
      refetchOnWindowFocus: false,
    },
  },
});

// ---------------------------------------------------------------- mocks
type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
export interface MockRequest { params: Record<string, string>; query: URLSearchParams; body: unknown }
type MockHandler = (request: MockRequest) => unknown | Promise<unknown>;
interface MockRoute { method: HttpMethod; pattern: RegExp; keys: string[]; handler: MockHandler }

const mockRoutes: MockRoute[] = [];

export function registerMock(method: HttpMethod, path: string, handler: MockHandler): void {
  const keys: string[] = [];
  const pattern = new RegExp(
    "^" + path.replace(/\/:([A-Za-z_]+)/g, (_match, key: string) => { keys.push(key); return "/([^/]+)"; }) + "$",
  );
  mockRoutes.push({ method, pattern, keys, handler });
}

let mocksLoaded = false;
function loadMocks(): void {
  if (mocksLoaded) return;
  mocksLoaded = true;
  import.meta.glob("../**/mocks.ts", { eager: true });
}

async function answerFromMock(method: HttpMethod, path: string, body: unknown): Promise<unknown> {
  loadMocks();
  const [pathname, search = ""] = path.split("?");
  for (const route of mockRoutes) {
    const match = route.method === method ? route.pattern.exec(pathname) : null;
    if (!match) continue;
    const params = Object.fromEntries(route.keys.map((key, index) => [key, decodeURIComponent(match[index + 1])]));
    return route.handler({ params, query: new URLSearchParams(search), body });
  }
  throw new ApiError(404, `No mock for ${method} ${pathname}`);
}

// ---------------------------------------------------------------- fetch
export interface ApiFetchOptions { method?: HttpMethod; body?: unknown; signal?: AbortSignal }

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  if (USE_MOCKS) return (await answerFromMock(method, path, options.body)) as T;

  const headers: Record<string, string> = {};
  const token = useAuthStore.getState().token;
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (options.body instanceof FormData) {
    body = options.body;
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  const response = await fetch(`${API_BASE_URL}/api${path}`, { method, headers, body, signal: options.signal });
  if (response.status === 401) useAuthStore.getState().logout();
  if (!response.ok) {
    let detail: unknown = response.statusText;
    try { detail = (await response.json()).detail ?? detail; } catch { /* body was not JSON */ }
    throw new ApiError(response.status, detail);
  }
  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get("content-type") ?? "";
  return (contentType.includes("application/json") ? await response.json() : await response.blob()) as T;
}

/** URL for files the browser opens directly (e.g. a PO PDF in an iframe). Adds the token as a query value. */
export function fileUrl(path: string): string {
  const token = useAuthStore.getState().token ?? "";
  return `${API_BASE_URL}/api${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
}

// ---------------------------------------------------------------- live events
type LiveListener = (event: LiveEvent) => void;
const liveListeners = new Set<LiveListener>();
let socket: WebSocket | null = null;
let reconnectDelayMs = 1000;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

function dispatchLiveEvent(event: LiveEvent): void {
  liveListeners.forEach((listener) => listener(event));
}

/** Mock mode only: push an event to every useLiveEvents listener (used by mock event generators). */
export function emitMockEvent(event: LiveEvent): void {
  dispatchLiveEvent(event);
}

function connectSocket(): void {
  if (USE_MOCKS || socket || liveListeners.size === 0) return;
  const token = useAuthStore.getState().token;
  if (!token) return;
  socket = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token)}`);
  socket.onopen = () => { reconnectDelayMs = 1000; };
  socket.onmessage = (message) => {
    try {
      const event = JSON.parse(message.data as string) as LiveEvent | { type: "heartbeat" };
      if (event.type !== "heartbeat") dispatchLiveEvent(event as LiveEvent);
    } catch { /* ignore malformed frames */ }
  };
  socket.onclose = () => {
    socket = null;
    if (liveListeners.size === 0) return;
    reconnectTimer = setTimeout(connectSocket, reconnectDelayMs);
    reconnectDelayMs = Math.min(reconnectDelayMs * 2, 30_000);
  };
}

export function disconnectLiveEvents(): void {
  clearTimeout(reconnectTimer);
  socket?.close();
  socket = null;
}

/** Calls `handler` for live events of the given types. One shared WebSocket serves every listener. */
export function useLiveEvents<T extends LiveEventType>(types: T[], handler: (event: LiveEvent<T>) => void): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const typesKey = types.join(",");
  const token = useAuthStore((state) => state.token);

  useEffect(() => {
    const wanted = new Set<string>(typesKey.split(","));
    const listener: LiveListener = (event) => {
      if (wanted.has(event.type)) handlerRef.current(event as LiveEvent<T>);
    };
    liveListeners.add(listener);
    connectSocket();
    return () => {
      liveListeners.delete(listener);
      if (liveListeners.size === 0) disconnectLiveEvents();
    };
  }, [typesKey, token]);
}

/** Test hook: run the mock router directly. */
export const __answerFromMockForTests = answerFromMock;
