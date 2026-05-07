import { createRequire } from "node:module";
import { HttpsProxyAgent } from "https-proxy-agent";
import { ProxyAgent, setGlobalDispatcher } from "undici";

export const PROXY_ENV_PRIORITY = [
  "CXB_PROXY",
  "DISCORD_PROXY",
  "HTTPS_PROXY",
  "https_proxy",
  "ALL_PROXY",
  "all_proxy",
  "HTTP_PROXY",
  "http_proxy"
] as const;

export interface ProxySelection {
  name: string;
  url: string;
}

export function selectProxyEnv(env: NodeJS.ProcessEnv = process.env): ProxySelection | undefined {
  for (const name of PROXY_ENV_PRIORITY) {
    const value = env[name]?.trim();
    if (value) {
      return { name, url: normalizeProxyUrl(value) };
    }
  }
  return undefined;
}

export function configureProxyFromEnv(env: NodeJS.ProcessEnv = process.env): ProxySelection | undefined {
  const proxy = selectProxyEnv(env);
  if (!proxy) return undefined;
  setGlobalDispatcher(new ProxyAgent(proxy.url));
  installWsProxy(proxy.url);
  return proxy;
}

export function normalizeProxyUrl(value: string): string {
  const trimmed = value.trim();
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;
  const url = new URL(withProtocol);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      `Unsupported proxy protocol ${url.protocol}. Use an HTTP proxy URL such as http://127.0.0.1:7890.`
    );
  }
  return url.toString();
}

export function maskProxyUrl(value: string): string {
  const url = new URL(normalizeProxyUrl(value));
  if (url.username) url.username = "***";
  if (url.password) url.password = "***";
  return url.toString();
}

function installWsProxy(proxyUrl: string): void {
  const require = createRequire(import.meta.url);
  const ws = require("ws") as typeof import("ws") & { __cxbProxyUrl?: string };
  if (ws.__cxbProxyUrl === proxyUrl) return;

  const OriginalWebSocket = ws.WebSocket;
  class ProxiedWebSocket extends OriginalWebSocket {
    constructor(address: string | URL, protocols?: string | string[], options: import("ws").ClientOptions = {}) {
      super(address, protocols ?? [], {
        ...options,
        agent: options.agent ?? new HttpsProxyAgent(proxyUrl)
      });
    }
  }

  Object.defineProperties(ProxiedWebSocket, {
    CONNECTING: { value: OriginalWebSocket.CONNECTING },
    OPEN: { value: OriginalWebSocket.OPEN },
    CLOSING: { value: OriginalWebSocket.CLOSING },
    CLOSED: { value: OriginalWebSocket.CLOSED }
  });

  ws.WebSocket = ProxiedWebSocket as typeof OriginalWebSocket;
  ws.__cxbProxyUrl = proxyUrl;
}
