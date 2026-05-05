const NETWORK_CODES = new Set([
  "UND_ERR_CONNECT_TIMEOUT",
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN"
]);

export function isNetworkError(error: unknown): boolean {
  const value = error as { code?: string; message?: string };
  return Boolean(
    (value.code && NETWORK_CODES.has(value.code)) ||
      value.message?.includes("Connect Timeout Error") ||
      value.message?.includes("UND_ERR_CONNECT_TIMEOUT")
  );
}

export function formatCliError(error: unknown): string {
  const message = (error as Error).message || String(error);
  if (isNetworkError(error)) {
    return [
      "Network error while contacting Discord.",
      message,
      "",
      "Check that this machine can reach https://discord.com/api and that your VPN/proxy/firewall/DNS is working.",
      "After the network is available, rerun the same command."
    ].join("\n");
  }
  return message;
}
