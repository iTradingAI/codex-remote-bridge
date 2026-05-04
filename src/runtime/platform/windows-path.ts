export function windowsPathToWslPath(path: string): string {
  const match = /^([a-zA-Z]):\\(.*)$/.exec(path);
  if (!match) {
    return path.replace(/\\/g, "/");
  }
  const drive = match[1]?.toLowerCase();
  const rest = (match[2] ?? "").replace(/\\/g, "/");
  return `/mnt/${drive}/${rest}`;
}

export function quoteShell(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function safeTmuxSessionName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
