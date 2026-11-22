/**
 * MindSpace Stage 8 — Safe Browser Shim for Node Built-ins.
 * Ensures any transitive Node built-in reference resolves safely in the browser.
 */
export const fileURLToPath = (url: string | URL): string => {
  if (typeof url === "string") return url;
  if (url && typeof url === "object" && "pathname" in url) return (url as URL).pathname;
  return String(url || "");
};

export const pathToFileURL = (path: string): URL => {
  return new URL(`file://${path}`);
};

export const dirname = (p: string): string => {
  const parts = p.replace(/\\/g, "/").split("/");
  parts.pop();
  return parts.join("/") || "/";
};

export const resolve = (...paths: string[]): string => {
  return paths.join("/").replace(/\\/g, "/");
};

export const join = (...paths: string[]): string => {
  return paths.join("/").replace(/\\/g, "/");
};

export const existsSync = (): boolean => false;
export const mkdirSync = (): void => {};
export const readFileSync = (): string => "";
export const writeFileSync = (): void => {};

export default {
  fileURLToPath,
  pathToFileURL,
  dirname,
  resolve,
  join,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
};
