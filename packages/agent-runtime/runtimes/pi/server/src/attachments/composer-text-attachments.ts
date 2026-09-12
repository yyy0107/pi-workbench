import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, readFile, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  atomicReplaceFile,
  withCrossProcessFileLock,
} from "@workbench/server-core/file-persistence";
import {
  MANAGED_FILE_MAX_BYTES,
  MANAGED_FILE_MAX_COUNT,
  MANAGED_FILE_MAX_TOTAL_BYTES,
  MANAGED_IMAGE_MEDIA_TYPES,
  PASTED_TEXT_MAX_BYTES,
  PASTED_TEXT_MAX_COUNT,
  PASTED_TEXT_READ_PAGE_SIZE,
  detectManagedImageMediaType,
  parseManagedFileAttachment,
  parseManagedImageAttachment,
  parsePastedTextAttachment,
  type ComposerAttachmentService,
  type CreateManagedFileAttachmentRequest,
  type CreateManagedImageAttachmentRequest,
  type CreatePastedTextAttachmentRequest,
  type ManagedFileAttachment,
  type ManagedImageAttachment,
  type PastedTextAttachment,
  type ReadManagedImageAttachmentRequest,
  type ReadManagedImageAttachmentResult,
  type ReadManagedFileAttachmentRequest,
  type ReadManagedFileAttachmentResult,
  type ReadPastedTextAttachmentRequest,
  type ReadPastedTextAttachmentResult,
} from "@workbench/agent-runtime-contracts/composer-attachments";
import { INLINE_IMAGE_LIMITS } from "@workbench/agent-runtime-pi-protocol/attachments";
import { admitInlineImages, InlineImageAdmissionError } from "../sessions/inline-image-admission";

type StoredAttachmentDescriptor = PastedTextAttachment | ManagedFileAttachment;

interface StoredAttachment {
  state: "ready" | "retained" | "discarded";
  attachment?: StoredAttachmentDescriptor;
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

function validateId(id: string, code = "text-attachment-invalid"): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(id)) {
    throw new ComposerAttachmentError(code);
  }
}

function currentDateSegment(now = new Date()): string {
  const year = String(now.getFullYear()).padStart(4, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function validateFileName(name: string): void {
  const hasControlCharacter = [...name].some((character) => {
    const codePoint = character.codePointAt(0)!;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
  if (
    !name.trim() ||
    name === "." ||
    name === ".." ||
    name.length > 255 ||
    Buffer.byteLength(name, "utf8") > 255 ||
    hasControlCharacter ||
    name.includes("/") ||
    name.includes("\\")
  ) {
    throw new ComposerAttachmentError("file-attachment-invalid");
  }
}

function validateMediaType(mediaType: string): void {
  if (
    !mediaType ||
    mediaType.length > 255 ||
    !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/iu.test(mediaType)
  ) {
    throw new ComposerAttachmentError("file-attachment-invalid");
  }
}

function fileTypeSegment(name: string, mediaType: string): string {
  const extension = path.extname(name).slice(1).toLowerCase();
  if (/^[a-z0-9]{1,32}$/u.test(extension)) return extension;
  const subtype = mediaType
    .split("/")[1]
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_");
  return subtype && /^[a-z0-9_]{1,64}$/u.test(subtype) ? subtype : "file";
}

function decodeCanonicalBase64(data: string): Buffer {
  if (data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(data)) {
    throw new ComposerAttachmentError("file-attachment-invalid");
  }
  const bytes = Buffer.from(data, "base64");
  if (bytes.toString("base64") !== data) {
    throw new ComposerAttachmentError("file-attachment-invalid");
  }
  if (bytes.length > MANAGED_FILE_MAX_BYTES) {
    throw new ComposerAttachmentError("attachment-too-large");
  }
  return bytes;
}

function managedFileHash(mediaType: string, name: string, bytes: Uint8Array): string {
  return createHash("sha256")
    .update(mediaType)
    .update("\0")
    .update(name)
    .update("\0")
    .update(bytes)
    .digest("hex");
}

async function atomicReplaceBinaryFile(file: string, content: Uint8Array): Promise<void> {
  const directory = path.dirname(file);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(
    directory,
    `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(content);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** One registry protects discard/retain races, including requests from another Runtime process. */
export class ComposerAttachmentStore implements ComposerAttachmentService {
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
            const attachment =
              parsePastedTextAttachment(entry?.attachment) ??
              parseManagedFileAttachment(entry?.attachment);
            if (
              !entry ||
              !["ready", "retained", "discarded"].includes(entry.state) ||
              (entry.state !== "discarded" &&
                (!attachment || attachment.id !== id || !this.validStoredPath(attachment)))
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

  private newFile(
    id: string,
    name: string,
    mediaType: string,
    type = fileTypeSegment(name, mediaType),
  ): string {
    return path.join(this.directory, currentDateSegment(), type, id, name);
  }

  private textFile(id: string): string {
    return this.newFile(id, "pasted-text.txt", "text/plain", "pasted_txt");
  }

  private validStoredPath(attachment: StoredAttachmentDescriptor): boolean {
    if (path.resolve(attachment.path) !== attachment.path) return false;
    const relative = path.relative(this.directory, attachment.path);
    if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
      return false;
    const segments = relative.split(path.sep);
    if (segments.length === 2) {
      return segments[0] === attachment.id && segments[1] === path.basename(attachment.path);
    }
    return (
      segments.length === 4 &&
      /^\d{4}-\d{2}-\d{2}$/u.test(segments[0]!) &&
      /^[a-z0-9_]{1,64}$/u.test(segments[1]!) &&
      segments[2] === attachment.id &&
      segments[3] === attachment.name
    );
  }

  private async resolvedFile(
    attachment: StoredAttachmentDescriptor,
    code: string,
  ): Promise<string> {
    if (!this.validStoredPath(attachment)) throw new ComposerAttachmentError(code);
    const root = await realpath(this.directory);
    const file = attachment.path;
    const parent = await realpath(path.dirname(file));
    if (parent !== path.dirname(file) || !parent.startsWith(`${root}${path.sep}`)) {
      throw new ComposerAttachmentError(code);
    }
    return file;
  }

  private async contents(attachment: PastedTextAttachment): Promise<string> {
    try {
      const file = await this.resolvedFile(attachment, "text-attachment-invalid");
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

  private async fileContents(
    attachment: ManagedFileAttachment,
    expectedHash?: string,
  ): Promise<Buffer> {
    try {
      const file = await this.resolvedFile(attachment, "file-attachment-invalid");
      const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size !== attachment.bytes)
          throw new ComposerAttachmentError("file-attachment-unavailable");
        if (stat.size > MANAGED_FILE_MAX_BYTES)
          throw new ComposerAttachmentError("attachment-too-large");
        const bytes = await handle.readFile();
        if (MANAGED_IMAGE_MEDIA_TYPES.some((mediaType) => mediaType === attachment.mediaType)) {
          const [validated] = admitInlineImages([
            {
              data: bytes.toString("base64"),
              mediaType: attachment.mediaType,
              name: attachment.name,
            },
          ]);
          if (!validated) throw new ComposerAttachmentError("file-attachment-unavailable");
        }
        if (
          expectedHash !== undefined &&
          managedFileHash(attachment.mediaType, attachment.name, bytes) !== expectedHash
        ) {
          throw new ComposerAttachmentError("file-attachment-unavailable");
        }
        return bytes;
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (error instanceof ComposerAttachmentError) throw error;
      throw new ComposerAttachmentError("file-attachment-unavailable");
    }
  }

  private async retryRemovals(registry: Registry, save: () => Promise<void>): Promise<void> {
    let changed = false;
    for (const [id, entry] of Object.entries(registry)) {
      if (entry.state !== "discarded" || !entry.pendingRemoval) continue;
      try {
        const attachment =
          parsePastedTextAttachment(entry.attachment) ??
          parseManagedFileAttachment(entry.attachment);
        const removalDirectory =
          attachment && this.validStoredPath(attachment)
            ? path.dirname(attachment.path)
            : path.join(this.directory, id);
        await rm(removalDirectory, { recursive: true, force: true });
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
        const attachment = parsePastedTextAttachment(existing.attachment);
        if (existing.hash !== hash || !attachment)
          throw new ComposerAttachmentError("text-attachment-conflict");
        await this.contents(attachment);
        return attachment;
      }
      const attachment: PastedTextAttachment = {
        id,
        name: "pasted-text.txt",
        mediaType: "text/plain",
        path: this.textFile(id),
        bytes,
        characterCount: text.length,
        preview: text.replace(/\s+/gu, " ").trim().slice(0, 80),
      };
      const directory = path.dirname(attachment.path);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await this.resolvedFile(attachment, "text-attachment-invalid");
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

  async createFile({
    id,
    name,
    mediaType,
    data,
  }: CreateManagedFileAttachmentRequest): Promise<ManagedFileAttachment> {
    validateId(id, "file-attachment-invalid");
    validateFileName(name);
    validateMediaType(mediaType);
    const bytes = decodeCanonicalBase64(data);
    const detectedImageMediaType = detectManagedImageMediaType(bytes);
    let storedMediaType = detectedImageMediaType ?? mediaType;
    if (
      detectedImageMediaType ||
      MANAGED_IMAGE_MEDIA_TYPES.some((candidate) => candidate === mediaType)
    ) {
      try {
        const [image] = admitInlineImages([{ data, mediaType: storedMediaType, name }]);
        if (!image) throw new ComposerAttachmentError("file-attachment-invalid");
        storedMediaType = image.mimeType;
      } catch (error) {
        if (error instanceof InlineImageAdmissionError) {
          throw new ComposerAttachmentError(
            error.reason === "INLINE_IMAGE_TOO_LARGE" ||
              error.reason === "INLINE_IMAGES_TOTAL_TOO_LARGE"
              ? "attachment-too-large"
              : "file-attachment-invalid",
          );
        }
        throw error;
      }
    }
    const hash = managedFileHash(storedMediaType, name, bytes);
    return this.transaction(async (registry, save) => {
      await this.retryRemovals(registry, save);
      const existing = registry[id];
      if (existing?.state === "discarded")
        throw new ComposerAttachmentError("file-attachment-discarded");
      if (existing) {
        const attachment = parseManagedFileAttachment(existing.attachment);
        if (existing.hash !== hash || !attachment)
          throw new ComposerAttachmentError("file-attachment-conflict");
        await this.fileContents(attachment, existing.hash);
        return attachment;
      }
      const attachment: ManagedFileAttachment = {
        id,
        name,
        mediaType: storedMediaType,
        path: this.newFile(id, name, storedMediaType),
        bytes: bytes.length,
      };
      const directory = path.dirname(attachment.path);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await this.resolvedFile(attachment, "file-attachment-invalid");
      try {
        await atomicReplaceBinaryFile(attachment.path, bytes);
        registry[id] = { state: "ready", attachment, hash };
        await save();
      } catch (error) {
        await rm(directory, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      }
      return attachment;
    });
  }

  async createImage(input: CreateManagedImageAttachmentRequest): Promise<ManagedImageAttachment> {
    const attachment = parseManagedImageAttachment(await this.createFile(input));
    if (!attachment) throw new ComposerAttachmentError("image-attachment-invalid");
    return attachment;
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
      const attachment = parsePastedTextAttachment(entry?.attachment);
      if (!attachment || entry?.state === "discarded")
        throw new ComposerAttachmentError("text-attachment-unavailable");
      const text = await this.contents(attachment);
      if (offset > text.length) throw new ComposerAttachmentError("text-attachment-invalid");
      let end = Math.min(text.length, offset + PASTED_TEXT_READ_PAGE_SIZE);
      if (end < text.length && /[\uD800-\uDBFF]/u.test(text[end - 1]!)) end--;
      return {
        attachment,
        text: text.slice(offset, end),
        ...(end < text.length ? { nextOffset: end } : {}),
      };
    });
  }

  async readFile({
    id,
  }: ReadManagedFileAttachmentRequest): Promise<ReadManagedFileAttachmentResult> {
    validateId(id, "file-attachment-invalid");
    return this.transaction(async (registry) => {
      const entry = registry[id];
      const attachment = parseManagedFileAttachment(entry?.attachment);
      if (!attachment || entry?.state === "discarded")
        throw new ComposerAttachmentError("file-attachment-unavailable");
      const bytes = await this.fileContents(attachment, entry?.hash);
      return { attachment, data: bytes.toString("base64") };
    });
  }

  async readImage(
    input: ReadManagedImageAttachmentRequest,
  ): Promise<ReadManagedImageAttachmentResult> {
    const result = await this.readFile(input);
    const attachment = parseManagedImageAttachment(result.attachment);
    if (!attachment) throw new ComposerAttachmentError("image-attachment-unavailable");
    return { attachment, data: result.data };
  }

  async discard({ id }: { id: string }): Promise<void> {
    validateId(id);
    await this.transaction(async (registry, save) => {
      if (registry[id]?.state === "retained") return;
      // A tombstone also prevents an in-flight create from resurrecting a removed card.
      registry[id] = {
        state: "discarded",
        pendingRemoval: true,
        ...(registry[id]?.attachment === undefined ? {} : { attachment: registry[id]!.attachment }),
      };
      await save();
      await this.retryRemovals(registry, save);
    });
  }

  async retain(ids: readonly string[]): Promise<PastedTextAttachment[]> {
    if (ids.length > PASTED_TEXT_MAX_COUNT)
      throw new ComposerAttachmentError("too-many-attachments");
    ids.forEach((id) => validateId(id));
    if (!ids.length) return [];
    return this.transaction(async (registry, save) => {
      const attachments: PastedTextAttachment[] = [];
      for (const id of new Set(ids)) {
        const entry = registry[id];
        const attachment = parsePastedTextAttachment(entry?.attachment);
        if (!attachment || entry?.state === "discarded")
          throw new ComposerAttachmentError("text-attachment-unavailable");
        await this.contents(attachment);
        attachments.push(attachment);
      }
      for (const attachment of attachments) registry[attachment.id]!.state = "retained";
      await save();
      return attachments;
    });
  }

  async retainFiles(ids: readonly string[]): Promise<ManagedFileAttachment[]> {
    if (ids.length > MANAGED_FILE_MAX_COUNT)
      throw new ComposerAttachmentError("too-many-attachments");
    ids.forEach((id) => validateId(id, "file-attachment-invalid"));
    if (!ids.length) return [];
    return this.transaction(async (registry, save) => {
      const attachments: ManagedFileAttachment[] = [];
      let totalBytes = 0;
      for (const id of new Set(ids)) {
        const entry = registry[id];
        const attachment = parseManagedFileAttachment(entry?.attachment);
        if (!attachment || entry?.state === "discarded")
          throw new ComposerAttachmentError("file-attachment-unavailable");
        await this.fileContents(attachment, entry?.hash);
        totalBytes += attachment.bytes;
        if (totalBytes > MANAGED_FILE_MAX_TOTAL_BYTES)
          throw new ComposerAttachmentError("attachment-too-large");
        attachments.push(attachment);
      }
      for (const attachment of attachments) registry[attachment.id]!.state = "retained";
      await save();
      return attachments;
    });
  }

  async retainImages(ids: readonly string[]): Promise<ManagedImageAttachment[]> {
    if (ids.length > INLINE_IMAGE_LIMITS.maxCount)
      throw new ComposerAttachmentError("too-many-attachments");
    ids.forEach((id) => validateId(id, "image-attachment-invalid"));
    if (!ids.length) return [];
    return this.transaction(async (registry, save) => {
      const attachments: ManagedImageAttachment[] = [];
      let totalBytes = 0;
      for (const id of new Set(ids)) {
        const entry = registry[id];
        const attachment = parseManagedImageAttachment(entry?.attachment);
        if (!attachment || entry?.state === "discarded")
          throw new ComposerAttachmentError("image-attachment-unavailable");
        await this.fileContents(attachment, entry?.hash);
        totalBytes += attachment.bytes;
        if (totalBytes > INLINE_IMAGE_LIMITS.maxDecodedBytesTotal)
          throw new ComposerAttachmentError("attachment-too-large");
        attachments.push(attachment);
      }
      for (const attachment of attachments) registry[attachment.id]!.state = "retained";
      await save();
      return attachments;
    });
  }
}

export { ComposerAttachmentStore as ComposerTextAttachmentStore };

export function getComposerAttachmentStore(): ComposerAttachmentStore {
  return new ComposerAttachmentStore(
    path.resolve(
      process.env.PI_WORKBENCH_STATE_DIR?.trim() || path.resolve(getAgentDir(), "..", "workbench"),
      "attachments",
    ),
  );
}

/** @deprecated Compatibility alias while callers migrate from the text-only store name. */
export const getComposerTextAttachmentStore = getComposerAttachmentStore;
