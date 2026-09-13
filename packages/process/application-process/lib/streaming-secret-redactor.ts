import { StringDecoder } from "node:string_decoder";

export interface StreamingSecretRedactor {
  write(chunk: Uint8Array): void;
  end(): void;
}

/** Keeps a secret-length tail so credentials split across arbitrary stderr chunks stay removed. */
export function createStreamingSecretRedactor(
  secrets: readonly string[],
  emit: (text: string) => void,
): StreamingSecretRedactor {
  const candidates = [...new Set(secrets.filter(Boolean))].sort(
    (left, right) => right.length - left.length,
  );
  const maximumSecretLength = Math.max(1, ...candidates.map((secret) => secret.length));
  const decoder = new StringDecoder("utf8");
  let pending = "";
  const redact = (value: string) =>
    candidates.reduce((result, secret) => result.split(secret).join("[REDACTED]"), value);
  const safeEmit = (value: string) => {
    try {
      emit(value);
    } catch {
      // Diagnostics must never destabilize the control/lifecycle owner.
    }
  };
  const flush = () => {
    while (pending.length >= maximumSecretLength) {
      const secret = candidates.find((candidate) => pending.startsWith(candidate));
      if (secret) {
        safeEmit("[REDACTED]");
        pending = pending.slice(secret.length);
      } else {
        safeEmit(pending[0]);
        pending = pending.slice(1);
      }
    }
  };
  return Object.freeze({
    write(chunk: Uint8Array) {
      pending += decoder.write(Buffer.from(chunk));
      flush();
    },
    end() {
      pending += decoder.end();
      safeEmit(redact(pending));
      pending = "";
    },
  });
}
