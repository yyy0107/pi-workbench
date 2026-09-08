/* eslint-disable no-control-regex -- Cookie names, values and paths reject protocol control characters. */
import { BrowserError } from "./errors";

const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const MAX_IMPORT_RECORDS = 10_000;

function importText(value: unknown): string {
  if (typeof value !== "string") throw new BrowserError("browser-invalid");
  if (Buffer.byteLength(value) > MAX_IMPORT_BYTES) throw new BrowserError("browser-file-too-large");
  return value.replace(/^\uFEFF/, "");
}

function httpUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 16_384) throw new BrowserError("browser-invalid");
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
      throw new Error();
    return url.href;
  } catch {
    throw new BrowserError("browser-invalid");
  }
}

export interface ImportedPassword {
  url: string;
  username: string;
  password: string;
  note: string;
  useAccountStore: false;
}

/** CSV permits commas and line breaks inside quoted passwords; splitting lines loses data. */
export function parsePasswordCsv(value: unknown): ImportedPassword[] {
  const text = importText(value);
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;
  for (let index = 0; index <= text.length; index++) {
    const character = text[index];
    if (quoted) {
      if (character === undefined) throw new BrowserError("browser-invalid");
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index++;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else field += character;
      continue;
    }
    if (character === '"') {
      if (field || closedQuote) throw new BrowserError("browser-invalid");
      quoted = true;
    } else if (
      character === "," ||
      character === "\n" ||
      character === "\r" ||
      character === undefined
    ) {
      row.push(field);
      field = "";
      closedQuote = false;
      if (character !== ",") {
        if (row.some((cell) => cell !== "")) records.push(row);
        row = [];
        if (character === "\r" && text[index + 1] === "\n") index++;
        if (records.length > MAX_IMPORT_RECORDS + 1)
          throw new BrowserError("browser-file-too-large");
      }
    } else {
      if (closedQuote) throw new BrowserError("browser-invalid");
      field += character;
    }
  }
  const headers = records.shift()?.map((header) => header.trim().toLowerCase()) ?? [];
  const column = (...names: string[]) => headers.findIndex((header) => names.includes(header));
  const urlIndex = column("url", "login_uri");
  const usernameIndex = column("username", "login_username");
  const passwordIndex = column("password", "login_password");
  const noteIndex = column("note", "notes");
  if (urlIndex < 0 || usernameIndex < 0 || passwordIndex < 0 || records.length === 0) {
    throw new BrowserError("browser-invalid");
  }
  return records.map((record) => {
    if (record.length !== headers.length || record.some((cell) => cell.length > 16_384)) {
      throw new BrowserError("browser-invalid");
    }
    const password = record[passwordIndex] ?? "";
    if (!password) throw new BrowserError("browser-invalid");
    return {
      url: httpUrl(record[urlIndex]),
      username: record[usernameIndex] ?? "",
      password,
      note: record[noteIndex] ?? "",
      useAccountStore: false,
    };
  });
}

export function parseCookieJson(value: unknown): Record<string, unknown>[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(importText(value));
  } catch (error) {
    if (error instanceof BrowserError) throw error;
    throw new BrowserError("browser-invalid");
  }
  const cookies = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && "cookies" in parsed
      ? parsed.cookies
      : undefined;
  if (!Array.isArray(cookies) || !cookies.length) throw new BrowserError("browser-invalid");
  if (cookies.length > MAX_IMPORT_RECORDS) throw new BrowserError("browser-file-too-large");
  return cookies.map((cookie: unknown) => {
    if (!cookie || typeof cookie !== "object") throw new BrowserError("browser-invalid");
    const entry = cookie as Record<string, unknown>;
    if (
      typeof entry.name !== "string" ||
      typeof entry.value !== "string" ||
      /[\x00-\x20;=]/.test(entry.name) ||
      /[\x00-\x1F\x7F]/.test(entry.value) ||
      Buffer.byteLength(entry.name + entry.value) > 8192
    ) {
      throw new BrowserError("browser-invalid");
    }
    const secure = entry.secure === true;
    const domain = typeof entry.domain === "string" ? entry.domain : undefined;
    if (domain && (!/^[.]?[^\s/:?#@]+$/.test(domain) || domain.length > 253))
      throw new BrowserError("browser-invalid");
    const url =
      entry.url === undefined
        ? httpUrl(`${secure ? "https" : "http"}://${domain?.replace(/^\./, "") ?? ""}/`)
        : httpUrl(entry.url);
    if (
      domain &&
      !(
        new URL(url).hostname === domain.replace(/^\./, "") ||
        new URL(url).hostname.endsWith(domain.startsWith(".") ? domain : `.${domain}`)
      )
    ) {
      throw new BrowserError("browser-invalid");
    }
    const cookiePath = entry.path === undefined ? "/" : entry.path;
    if (
      typeof cookiePath !== "string" ||
      !cookiePath.startsWith("/") ||
      /[\x00-\x1F]/.test(cookiePath)
    )
      throw new BrowserError("browser-invalid");
    const expires = entry.expires ?? entry.expirationDate;
    if (expires !== undefined && (typeof expires !== "number" || !Number.isFinite(expires)))
      throw new BrowserError("browser-invalid");
    const sameSite =
      entry.sameSite === undefined || entry.sameSite === "unspecified"
        ? undefined
        : (
            { strict: "Strict", lax: "Lax", none: "None", no_restriction: "None" } as Record<
              string,
              string
            >
          )[String(entry.sameSite).toLowerCase()];
    if (
      (entry.sameSite !== undefined && entry.sameSite !== "unspecified" && !sameSite) ||
      (sameSite === "None" && !secure)
    )
      throw new BrowserError("browser-invalid");
    return {
      name: entry.name,
      value: entry.value,
      url,
      ...(domain && entry.hostOnly !== true ? { domain } : {}),
      path: cookiePath,
      secure,
      httpOnly: entry.httpOnly === true,
      ...(typeof expires === "number" && expires > 0 && entry.session !== true ? { expires } : {}),
      ...(sameSite ? { sameSite } : {}),
    };
  });
}
