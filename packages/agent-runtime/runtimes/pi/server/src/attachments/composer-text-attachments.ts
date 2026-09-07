import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, readFile, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  atomicReplaceFile,
  withCrossProcessFileLock,
} from "@workbench/server-core/file-persistence";
import {
  PASTED_TEXT_MAX_BYTES,
  PASTED_TEXT_MAX_COUNT,
  PASTED_TEXT_READ_PAGE_SIZE,
  parsePastedTextAttachment,
  type ComposerTextAttachmentService,
  type CreatePastedTextAttachmentRequest,
  type PastedTextAttachment,
  type ReadPastedTextAttachmentRequest,
  type ReadPastedTextAttachmentResult,
} from "@workbench/agent-runtime-contracts/composer-attachments";

interface StoredAttachment {
  state: "ready" | "retained" | "discarded";
  attachment?: PastedTextAttachment;
  hash?: string;
  pendingRemoval?: boolean;
}
type Registry = Record<string, StoredAttachment>;

export class ComposerAttachmentError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

function validateId(id: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(id)) {
    throw new ComposerAttachmentError("text-attachment-invalid");
  }
}

/** One registry protects discard/retain races, including requests from another Runtime process. */
export class ComposerTextAttachmentStore implements ComposerTextAttachmentService {
  readonly directory: string;
  constructor(directory: string) {
    this.directory = path.resolve(directory);
  }

  private async transaction<T>(
    operation: (registry: Registry, save: () => Promise<void>) => Promise<T>,
  ): Promise<T> {
    // ponytail: serialize this small registry; use per-attachment registries if upload throughput requires it.
    return withCrossProcessFileLock(
      { lockDirectory: path.join(this.directory, ".lock"), parentDirectoryMode: 0o700 },
      async () => {
        const registryPath = path.join(this.directory, "registry.json");
        let registry: Registry = {};
        try {
          const raw = JSON.parse(await readFile(registryPath, "utf8")) as Registry;
          for (const [id, entry] of Object.entries(raw)) {
            validateId(id);
            if (
              !entry ||
              !["ready", "retained", "discarded"].includes(entry.state) ||
              (entry.state !== "discarded" &&
                (!parsePastedTextAttachment(entry.attachment) ||
                  entry.attachment?.id !== id ||
                  entry.attachment.path !== this.file(id)))
            ) {
              throw new ComposerAttachmentError("text-attachment-invalid");
            }
          }
          registry = raw;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        const save = () =>
          atomicReplaceFile(registryPath, JSON.stringify(registry), { directoryMode: 0o700 });
        return operation(registry, save);
      },
    );
  }

  private file(id: string): string {
    return path.join(this.directory, id, "pasted-text.txt");
  }

  private async contents(attachment: PastedTextAttachment): Promise<string> {
    const file = this.file(attachment.id);
    try {
      if (
        (await realpath(path.dirname(file))) !==
        path.join(await realpath(this.directory), attachment.id)
      ) {
        throw new ComposerAttachmentError("text-attachment-invalid");
      }
      const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > PASTED_TEXT_MAX_BYTES)
          throw new ComposerAttachmentError("attachment-too-large");
        const bytes = await handle.readFile();
        if (bytes.length > PASTED_TEXT_MAX_BYTES)
          throw new ComposerAttachmentError("attachment-too-large");
        return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (error instanceof ComposerAttachmentError) throw error;
      throw new ComposerAttachmentError("text-attachment-unavailable");
    }
  }

  private async retryRemovals(registry: Registry, save: () => Promise<void>): Promise<void> {
    let changed = false;
    for (const [id, entry] of Object.entries(registry)) {
      if (entry.state !== "discarded" || !entry.pendingRemoval) continue;
      try {
        await rm(path.join(this.directory, id), { recursive: true, force: true });
        delete entry.pendingRemoval;
        changed = true;
      } catch {
        /* The durable pending flag retries on the next create/discard. */
      }
    }
    if (changed) await save();
  }

  async create({ id, text }: CreatePastedTextAttachmentRequest): Promise<PastedTextAttachment> {
    validateId(id);
    const bytes = Buffer.byteLength(text, "utf8");
    if (bytes > PASTED_TEXT_MAX_BYTES) throw new ComposerAttachmentError("attachment-too-large");
    if (!text.length || Buffer.from(text, "utf8").toString("utf8") !== text)
      throw new ComposerAttachmentError("text-attachment-invalid");
    const hash = createHash("sha256").update(text).digest("hex");
    return this.transaction(async (registry, save) => {
      await this.retryRemovals(registry, save);
      const existing = registry[id];
      if (existing?.state === "discarded")
        throw new ComposerAttachmentError("text-attachment-discarded");
      if (existing) {
        if (existing.hash !== hash || !existing.attachment)
          throw new ComposerAttachmentError("text-attachment-conflict");
        await this.contents(existing.attachment);
        return existing.attachment;
      }
      const attachment: PastedTextAttachment = {
        id,
        name: "pasted-text.txt",
        mediaType: "text/plain",
        path: this.file(id),
        bytes,
        characterCount: text.length,
        preview: text.replace(/\s+/gu, " ").trim().slice(0, 80),
      };
      const directory = path.dirname(attachment.path);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      if ((await realpath(directory)) !== path.join(await realpath(this.directory), id)) {
        throw new ComposerAttachmentError("text-attachment-invalid");
      }
      try {
        await atomicReplaceFile(attachment.path, text, { directoryMode: 0o700 });
        registry[id] = { state: "ready", attachment, hash };
        await save();
      } catch (error) {
        await rm(directory, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      }
      return attachment;
    });
  }

  async read({
    id,
    offset = 0,
  }: ReadPastedTextAttachmentRequest): Promise<ReadPastedTextAttachmentResult> {
    validateId(id);
    if (!Number.isSafeInteger(offset) || offset < 0)
      throw new ComposerAttachmentError("text-attachment-invalid");
    return this.transaction(async (registry) => {
      const entry = registry[id];
      if (!entry?.attachment || entry.state === "discarded")
        throw new ComposerAttachmentError("text-attachment-unavailable");
      const text = await this.contents(entry.attachment);
      if (offset > text.length) throw new ComposerAttachmentError("text-attachment-invalid");
      let end = Math.min(text.length, offset + PASTED_TEXT_READ_PAGE_SIZE);
      if (end < text.length && /[\uD800-\uDBFF]/u.test(text[end - 1]!)) end--;
      return {
        attachment: entry.attachment,
        text: text.slice(offset, end),
        ...(end < text.length ? { nextOffset: end } : {}),
      };
    });
  }

  async discard({ id }: { id: string }): Promise<void> {
    validateId(id);
    await this.transaction(async (registry, save) => {
      if (registry[id]?.state === "retained") return;
      // A tombstone also prevents an in-flight create from resurrecting a removed card.
      registry[id] = { state: "discarded", pendingRemoval: true };
      await save();
      await this.retryRemovals(registry, save);
    });
  }

  async retain(ids: readonly string[]): Promise<PastedTextAttachment[]> {
    if (ids.length > PASTED_TEXT_MAX_COUNT)
      throw new ComposerAttachmentError("too-many-attachments");
    ids.forEach(validateId);
    if (!ids.length) return [];
    return this.transaction(async (registry, save) => {
      const attachments: PastedTextAttachment[] = [];
      for (const id of new Set(ids)) {
        const entry = registry[id];
        if (!entry?.attachment || entry.state === "discarded")
          throw new ComposerAttachmentError("text-attachment-unavailable");
        await this.contents(entry.attachment);
        attachments.push(entry.attachment);
      }
      for (const attachment of attachments) registry[attachment.id]!.state = "retained";
      await save();
      return attachments;
    });
  }
}

export function getComposerTextAttachmentStore(): ComposerTextAttachmentStore {
  return new ComposerTextAttachmentStore(
    path.resolve(
      process.env.PI_WORKBENCH_STATE_DIR?.trim() || path.resolve(getAgentDir(), "..", "workbench"),
      "attachments",
    ),
  );
}
