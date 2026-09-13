import type {
  ComposerAttachment,
  ComposerSnapshot,
} from "@workbench/agent-runtime-contracts/conversation";
import {
  PASTED_TEXT_MAX_BYTES,
  PASTED_TEXT_MAX_COUNT,
  type ManagedFileAttachment,
  type PastedTextAttachment,
  type ReadManagedFileAttachmentRequest,
  type ReadManagedFileAttachmentResult,
  type ReadPastedTextAttachmentRequest,
  type ReadPastedTextAttachmentResult,
} from "@workbench/agent-runtime-contracts/composer-attachments";
import { PiApiError, callPiRpc } from "@workbench/pi-transport-client/api";
import type { PiRpcCallOptions } from "@workbench/pi-transport-client/api";

type ReplaceComposer = (patch: Partial<ComposerSnapshot>) => void;
export interface PiClientSessionAttachmentControllerOptions {
  readonly getComposer: () => ComposerSnapshot;
  readonly replaceComposer: ReplaceComposer;
  readonly rpcOptions: Readonly<Pick<PiRpcCallOptions, "invalidation" | "transport">>;
  readonly isDisposed: () => boolean;
}

export class PiClientSessionAttachmentController {
  private readonly pastedTextUploads = new Map<string, Promise<void>>();
  private readonly managedFileUploads = new Map<string, Promise<void>>();
  private readonly options: PiClientSessionAttachmentControllerOptions;

  constructor(options: PiClientSessionAttachmentControllerOptions) {
    this.options = options;
  }

  async addComposerAttachment(attachment: ComposerAttachment): Promise<void> {
    if (attachment.kind === "pasted-text" || attachment.kind === "managed-file")
      throw new TypeError("Use the managed Composer attachment APIs.");
    const mediaType = attachment.mediaType ?? /^data:([^;,]+)/u.exec(attachment.source)?.[1];
    if (!mediaType || !attachment.source.startsWith("data:")) {
      const error = Object.freeze({
        code: "attachment-invalid" as const,
        message: "Unsupported Composer attachment",
        recoverable: true,
      });
      this.options.replaceComposer({ phase: "error", error });
      throw new TypeError(error.message);
    }
    const composer = this.options.getComposer();
    if (composer.attachments.some(({ key }) => key === attachment.key)) return;
    const managed = Object.freeze({
      kind: "managed-file" as const,
      key: attachment.key,
      name: attachment.name,
      source: attachment.source,
      mediaType,
      status: "saving" as const,
    });
    this.options.replaceComposer({
      attachments: Object.freeze([...composer.attachments, managed]),
    });
    await this.uploadManagedFileAttachment(managed.key);
  }

  removeComposerAttachment(key: string): void {
    const composer = this.options.getComposer();
    const removed = composer.attachments.find((attachment) => attachment.key === key);
    const attachments = composer.attachments.filter((attachment) => attachment.key !== key);
    if (attachments.length === composer.attachments.length) return;
    this.options.replaceComposer({ attachments: Object.freeze(attachments) });
    if (removed?.kind === "pasted-text" || removed?.kind === "managed-file")
      this.discardComposerAttachment(key);
  }

  discardComposerAttachment(id: string): void {
    void callPiRpc("composer.attachments.discard", { id }, this.options.rpcOptions).catch((error) =>
      console.warn("[workbench] discard Composer attachment failed", error),
    );
  }

  async addPastedTextAttachment(text: string): Promise<void> {
    if (this.options.isDisposed()) return;
    const key = globalThis.crypto.randomUUID();
    const composer = this.options.getComposer();
    this.options.replaceComposer({
      attachments: Object.freeze([
        ...composer.attachments,
        {
          kind: "pasted-text" as const,
          key,
          name: "pasted-text.txt",
          mediaType: "text/plain" as const,
          status: "saving" as const,
          text,
        },
      ]),
    });
    await this.uploadPastedTextAttachment(key);
  }

  uploadPastedTextAttachment(key: string): Promise<void> {
    const activeUpload = this.pastedTextUploads.get(key);
    if (activeUpload) return activeUpload;
    const composer = this.options.getComposer();
    const item = composer.attachments.find((attachment) => attachment.key === key);
    if (this.options.isDisposed() || item?.kind !== "pasted-text" || item.status === "ready")
      return Promise.resolve();
    const saving = Object.freeze({ ...item, status: "saving" as const, error: undefined });
    this.options.replaceComposer({
      attachments: Object.freeze(
        composer.attachments.map((attachment) => (attachment === item ? saving : attachment)),
      ),
    });
    const upload = (async () => {
      try {
        if (new TextEncoder().encode(item.text).length > PASTED_TEXT_MAX_BYTES)
          throw new PiApiError("attachment-too-large", 400);
        if (this.options.getComposer().attachments.length > PASTED_TEXT_MAX_COUNT)
          throw new PiApiError("too-many-attachments", 400);
        const attachment = await callPiRpc<{ id: string; text: string }, PastedTextAttachment>(
          "composer.attachments.create",
          { id: key, text: item.text },
          this.options.rpcOptions,
        );
        const current = this.options.getComposer();
        if (this.options.isDisposed() || !current.attachments.includes(saving)) {
          this.discardComposerAttachment(key);
          return;
        }
        this.options.replaceComposer({
          attachments: Object.freeze(
            current.attachments.map((entry) =>
              entry === saving
                ? Object.freeze({
                    kind: "pasted-text" as const,
                    key,
                    name: attachment.name,
                    mediaType: "text/plain" as const,
                    status: "ready" as const,
                    attachment,
                  })
                : entry,
            ),
          ),
        });
      } catch (error) {
        const current = this.options.getComposer();
        if (this.options.isDisposed() || !current.attachments.includes(saving)) return;
        this.options.replaceComposer({
          attachments: Object.freeze(
            current.attachments.map((entry) =>
              entry === saving
                ? Object.freeze({
                    ...saving,
                    status: "error" as const,
                    error: error instanceof PiApiError ? error.code : "text-attachment-failed",
                  })
                : entry,
            ),
          ),
        });
      }
    })().finally(() => this.pastedTextUploads.delete(key));
    this.pastedTextUploads.set(key, upload);
    return upload;
  }

  private uploadManagedFileAttachment(key: string): Promise<void> {
    const activeUpload = this.managedFileUploads.get(key);
    if (activeUpload) return activeUpload;
    const composer = this.options.getComposer();
    const item = composer.attachments.find((attachment) => attachment.key === key);
    if (this.options.isDisposed() || item?.kind !== "managed-file" || item.status === "ready")
      return Promise.resolve();
    const saving = Object.freeze({ ...item, status: "saving" as const, error: undefined });
    this.options.replaceComposer({
      attachments: Object.freeze(
        composer.attachments.map((attachment) => (attachment === item ? saving : attachment)),
      ),
    });
    const upload = (async () => {
      try {
        const match = /^data:([^;,]+);base64,([\s\S]*)$/u.exec(item.source);
        if (!match || match[1] !== item.mediaType) throw new PiApiError("attachment-invalid", 400);
        const attachment = await callPiRpc<
          { id: string; name: string; mediaType: string; data: string },
          ManagedFileAttachment
        >(
          "composer.attachments.createFile",
          {
            id: key,
            name: item.name,
            mediaType: item.mediaType,
            data: match[2]!,
          },
          this.options.rpcOptions,
        );
        const current = this.options.getComposer();
        if (this.options.isDisposed() || !current.attachments.includes(saving)) {
          this.discardComposerAttachment(key);
          return;
        }
        this.options.replaceComposer({
          attachments: Object.freeze(
            current.attachments.map((entry) =>
              entry === saving
                ? Object.freeze({
                    kind: "managed-file" as const,
                    key,
                    name: attachment.name,
                    source: `data:${attachment.mediaType};base64,${match[2]!}`,
                    mediaType: attachment.mediaType,
                    status: "ready" as const,
                    attachment,
                  })
                : entry,
            ),
          ),
        });
      } catch (error) {
        const current = this.options.getComposer();
        if (this.options.isDisposed() || !current.attachments.includes(saving)) return;
        this.options.replaceComposer({
          attachments: Object.freeze(
            current.attachments.map((entry) =>
              entry === saving
                ? Object.freeze({
                    ...saving,
                    status: "error" as const,
                    error: error instanceof PiApiError ? error.code : "file-attachment-failed",
                  })
                : entry,
            ),
          ),
        });
      }
    })().finally(() => this.managedFileUploads.delete(key));
    this.managedFileUploads.set(key, upload);
    return upload;
  }

  readPastedTextAttachment(
    input: ReadPastedTextAttachmentRequest,
  ): Promise<ReadPastedTextAttachmentResult> {
    return callPiRpc("composer.attachments.read", input, this.options.rpcOptions);
  }

  readManagedFileAttachment(
    input: ReadManagedFileAttachmentRequest,
  ): Promise<ReadManagedFileAttachmentResult> {
    return callPiRpc("composer.attachments.readFile", input, this.options.rpcOptions);
  }

  dismissComposerError(): void {
    const composer = this.options.getComposer();
    if (!composer.error && composer.phase !== "error") return;
    this.options.replaceComposer({ phase: "idle", error: undefined });
  }

  async prepareComposerAttachments(
    attachments: readonly ComposerAttachment[],
  ): Promise<readonly ComposerAttachment[] | undefined> {
    await Promise.all(
      attachments.map((attachment) => {
        if (attachment.kind === "pasted-text" && attachment.status !== "ready")
          return this.uploadPastedTextAttachment(attachment.key);
        if (attachment.kind === "managed-file" && attachment.status !== "ready")
          return this.uploadManagedFileAttachment(attachment.key);
        return Promise.resolve();
      }),
    );
    if (this.options.isDisposed()) return undefined;
    const currentByKey = new Map(
      this.options.getComposer().attachments.map((attachment) => [attachment.key, attachment]),
    );
    const prepared = attachments.map((attachment) => currentByKey.get(attachment.key));
    return prepared.every((attachment) => attachment !== undefined)
      ? (prepared as ComposerAttachment[])
      : undefined;
  }

  dispose(): void {
    this.pastedTextUploads.clear();
    this.managedFileUploads.clear();
  }
}
