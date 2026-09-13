import type {
  BrowserConsoleEntry,
  BrowserNetworkEntry,
  BrowserNetworkQuery,
} from "@workbench/browser-contracts";
import type { CdpEvent } from "./cdp";
import { runInNewContext } from "node:vm";
import { BrowserError } from "./errors";

function textMatches(values: string[], pattern?: string): boolean[] {
  const end = pattern?.lastIndexOf("/") ?? -1;
  if (!pattern?.startsWith("/") || end <= 0)
    return values.map((value) => !pattern || value.includes(pattern));
  try {
    // Bound regex execution as well as output: a backtracking filter must not stall the runtime.
    return runInNewContext(
      "const re = new RegExp(source, flags); values.map(value => { re.lastIndex = 0; return re.test(value); })",
      {
        source: pattern.slice(1, end),
        flags: pattern.slice(end + 1),
        values,
      },
      { timeout: 50 },
    );
  } catch {
    throw new BrowserError("browser-invalid", "The diagnostic filter is invalid or took too long.");
  }
}

/** CDP records stay with their tab; observing one tab never drains another tab's history. */
export class BrowserDiagnostics {
  private sequence = 0;
  private consoleEntries: BrowserConsoleEntry[] = [];
  private requests = new Map<string, BrowserNetworkEntry>();
  private started = new Map<string, number>();
  private droppedConsole = 0;
  private droppedNetwork = 0;

  record({ method, params }: CdpEvent): void {
    if (
      method === "Runtime.consoleAPICalled" ||
      method === "Runtime.exceptionThrown" ||
      method === "Log.entryAdded"
    ) {
      const exception = params.exceptionDetails;
      const entry = params.entry;
      this.consoleEntries.push({
        seq: ++this.sequence,
        timestamp: Date.now(),
        level: exception
          ? "error"
          : (entry?.level ?? (params.type === "warning" ? "warn" : params.type)),
        text: String(
          exception?.exception?.description ??
            exception?.text ??
            entry?.text ??
            (params.args ?? [])
              .map((arg: Record<string, unknown>) =>
                arg.value === undefined
                  ? (arg.description ?? arg.type)
                  : typeof arg.value === "string"
                    ? arg.value
                    : JSON.stringify(arg.value),
              )
              .join(" "),
        ).slice(0, 4096),
        url: exception?.url ?? entry?.url ?? params.stackTrace?.callFrames?.[0]?.url,
      });
      if (this.consoleEntries.length > 500) this.droppedConsole = this.consoleEntries.shift()!.seq;
      return;
    }
    if (method === "Network.requestWillBeSent") {
      if (params.redirectResponse) {
        this.finish(params.requestId, params.redirectResponse, params.timestamp);
        const previous = this.requests.get(params.requestId);
        if (previous)
          this.requests.set(`${params.requestId}:redirect:${previous.seq}`, {
            ...previous,
            redirected: true,
          });
      }
      this.requests.set(params.requestId, {
        seq: ++this.sequence,
        requestId: params.requestId,
        url: String(params.request.url).slice(0, 8192),
        method: params.request.method,
        type: params.type ?? "Other",
        timestamp: Date.now(),
      });
      this.started.set(params.requestId, params.timestamp);
      if (this.requests.size > 500) {
        const oldest = this.requests.keys().next().value!;
        this.droppedNetwork = Math.max(this.droppedNetwork, this.requests.get(oldest)!.seq);
        this.requests.delete(oldest);
        this.started.delete(oldest);
      }
    } else if (method === "Network.responseReceived") {
      const entry = this.requests.get(params.requestId);
      if (entry)
        Object.assign(entry, {
          seq: ++this.sequence,
          status: params.response.status,
          mimeType: params.response.mimeType,
        });
    } else if (method === "Network.loadingFinished" || method === "Network.loadingFailed") {
      this.finish(
        params.requestId,
        { encodedDataLength: params.encodedDataLength },
        params.timestamp,
        params.errorText,
      );
    }
  }

  private finish(
    id: string,
    response: Record<string, any>,
    timestamp: number,
    error?: string,
  ): void {
    const entry = this.requests.get(id);
    if (!entry) return;
    Object.assign(entry, {
      seq: ++this.sequence,
      finished: true,
      durationMs: Math.max(0, Math.round((timestamp - (this.started.get(id) ?? timestamp)) * 1000)),
      ...(response.status === undefined ? {} : { status: response.status }),
      ...(response.encodedDataLength === undefined ? {} : { size: response.encodedDataLength }),
      ...(error ? { failed: error.slice(0, 1024) } : {}),
    });
    this.started.delete(id);
  }

  console(query: {
    sinceSeq?: number;
    sinceMs?: number;
    textPattern?: string;
    levels?: string[];
    limit?: number;
  }) {
    const matched = textMatches(
      this.consoleEntries.map((entry) => entry.text),
      query.textPattern,
    );
    const matches = this.consoleEntries.filter(
      (entry, index) =>
        matched[index] &&
        entry.seq > (query.sinceSeq ?? 0) &&
        (query.sinceMs === undefined || entry.timestamp >= Date.now() - query.sinceMs) &&
        (!query.levels?.length || query.levels.includes(entry.level)),
    );
    const entries = matches.slice(0, query.limit ?? 50).map((entry) => ({ ...entry }));
    return {
      entries,
      total: matches.length,
      truncated: matches.length > entries.length,
      nextCursor: matches.length > entries.length ? entries.at(-1)!.seq : this.sequence,
      bufferOverflowed: this.droppedConsole > (query.sinceSeq ?? 0),
    };
  }

  network(query: BrowserNetworkQuery) {
    const entries = [...this.requests.values()];
    const matched = textMatches(
      entries.map((entry) => entry.url),
      query.urlPattern,
    );
    const matches = entries
      .filter(
        (entry, index) =>
          matched[index] &&
          entry.seq > (query.sinceSeq ?? 0) &&
          (!query.methodFilter?.length || query.methodFilter.includes(entry.method)) &&
          (!query.resourceTypes?.length || query.resourceTypes.includes(entry.type)) &&
          (query.sinceMs === undefined || entry.timestamp >= Date.now() - query.sinceMs) &&
          (!query.statusFilter ||
            (entry.status !== undefined &&
              entry.status >= (query.statusFilter.min ?? 100) &&
              entry.status <= (query.statusFilter.max ?? 599))),
      )
      .sort((a, b) => a.seq - b.seq);
    const requests = matches.slice(0, query.limit ?? 50).map((entry) => ({ ...entry }));
    return {
      requests,
      total: matches.length,
      truncated: matches.length > requests.length,
      nextCursor: matches.length > requests.length ? requests.at(-1)!.seq : this.sequence,
      bufferOverflowed: this.droppedNetwork > (query.sinceSeq ?? 0),
    };
  }
}
