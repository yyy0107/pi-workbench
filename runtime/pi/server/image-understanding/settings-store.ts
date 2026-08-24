import { readFile } from "node:fs/promises";
import path from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

import type {
  ImageUnderstandingDescribeValue,
  ImageUnderstandingEngine,
  ImageUnderstandingOcrProvider,
  ImageUnderstandingRouting,
  ImageUnderstandingSettingsPatch,
  ImageUnderstandingUpdatePayload,
} from "../../rpc-contracts";
import {
  DEFAULT_PADDLE_AI_STUDIO_ASYNC_MODEL,
  PADDLE_AI_STUDIO_ASYNC_ENDPOINT,
} from "../../../image-understanding/paddleocr-models";
import {
  getOcrAdapterPreset,
  inferOcrAdapterPreset,
  OCR_ADAPTER_PRESET_IDS,
  OCR_ADAPTER_PRESETS,
  parseOcrAdapterSource,
  serializeOcrAdapterSource,
  type OcrAdapterPresetId,
} from "../../../image-understanding/ocr-adapter";
import { atomicReplaceFile, withCrossProcessFileLock } from "../core/file-persistence";

type JsonObject = Record<string, unknown>;

interface StoredSettingsValue {
  routing: ImageUnderstandingRouting;
  engine: ImageUnderstandingEngine;
  ocrProvider: ImageUnderstandingOcrProvider;
  glm: { endpoint: string; model: string };
  paddle: {
    endpoint: string;
    model: string;
    pollIntervalMs: number;
    pollTimeoutMs: number;
  };
  ocrAdapter: {
    preset: OcrAdapterPresetId;
    source: string;
    endpoint: string;
    model: string;
    pollIntervalMs: number;
    pollTimeoutMs: number;
  };
  multimodal: { provider: string; model: string };
}

type OcrCredentialSlot = ImageUnderstandingOcrProvider | "custom";

interface StoredDocumentV1 {
  version: 1;
  revision: number;
  settings: StoredSettingsValue;
  secrets: Partial<Record<OcrCredentialSlot, string>>;
}

interface StoreSnapshot {
  document: StoredDocumentV1;
}

export interface ImageUnderstandingSettingsStoreOptions {
  stateFile?: string;
}

export interface ImageUnderstandingRuntimeSettings extends ImageUnderstandingDescribeValue {
  /** Credential from the same atomic settings snapshot as `value`. Never expose over RPC. */
  credential?: string;
}

export type ImageUnderstandingSettingsStoreErrorCode =
  | "image-settings-conflict"
  | "image-settings-invalid"
  | "image-settings-io";

export class ImageUnderstandingSettingsStoreError extends Error {
  readonly code: ImageUnderstandingSettingsStoreErrorCode;
  readonly expectedRevision?: number;
  readonly actualRevision?: number;

  constructor(
    code: ImageUnderstandingSettingsStoreErrorCode,
    options: { expectedRevision?: number; actualRevision?: number } = {},
  ) {
    const message =
      code === "image-settings-conflict"
        ? "Attachment understanding settings changed before the update was applied."
        : code === "image-settings-invalid"
          ? "Attachment understanding settings are invalid."
          : "Attachment understanding settings could not be read or saved.";
    super(message);
    this.name = "ImageUnderstandingSettingsStoreError";
    this.code = code;
    this.expectedRevision = options.expectedRevision;
    this.actualRevision = options.actualRevision;
  }
}

export const DEFAULT_IMAGE_UNDERSTANDING_SETTINGS = Object.freeze({
  routing: "auto",
  engine: "ocr",
  ocrProvider: "glm-ocr",
  glm: {
    endpoint: "https://api.z.ai/api/paas/v4/layout_parsing",
    model: "glm-ocr",
  },
  paddle: {
    endpoint: PADDLE_AI_STUDIO_ASYNC_ENDPOINT,
    model: DEFAULT_PADDLE_AI_STUDIO_ASYNC_MODEL,
    pollIntervalMs: 3_000,
    pollTimeoutMs: 600_000,
  },
  ocrAdapter: {
    preset: "glm-ocr" as const,
    source: getOcrAdapterPreset("glm-ocr").source,
    endpoint: getOcrAdapterPreset("glm-ocr").endpoint,
    model: getOcrAdapterPreset("glm-ocr").model,
    pollIntervalMs: getOcrAdapterPreset("glm-ocr").pollIntervalMs,
    pollTimeoutMs: getOcrAdapterPreset("glm-ocr").pollTimeoutMs,
  },
  multimodal: { provider: "", model: "" },
}) satisfies StoredSettingsValue;

const ROUTING_VALUES = new Set<ImageUnderstandingRouting>([
  "auto",
  "always-preprocess",
  "native-only",
  "disabled",
]);
const ENGINE_VALUES = new Set<ImageUnderstandingEngine>(["ocr", "multimodal"]);
const OCR_PROVIDER_VALUES = new Set<ImageUnderstandingOcrProvider>(["glm-ocr", "paddleocr"]);
const OCR_ADAPTER_PRESET_VALUES = new Set<OcrAdapterPresetId>(OCR_ADAPTER_PRESET_IDS);
const OCR_CREDENTIAL_SLOTS = new Set<OcrCredentialSlot>(["glm-ocr", "paddleocr", "custom"]);
function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown, field: string, maximumLength = 2_048): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximumLength) {
    throw new TypeError(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function optionalString(value: unknown, field: string, maximumLength = 256): string {
  if (typeof value !== "string" || value.length > maximumLength) {
    throw new TypeError(`${field} must be a string.`);
  }
  return value.trim();
}

function endpoint(value: unknown, field: string): string {
  const parsed = new URL(nonEmptyString(value, field));
  if (parsed.protocol !== "https:") throw new TypeError(`${field} must use HTTPS.`);
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new TypeError(`${field} must not contain credentials, query parameters, or fragments.`);
  }
  return parsed.toString();
}

function optionalProviderId(value: unknown, field: string): string {
  const parsed = optionalString(value, field, 128);
  if (parsed && !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(parsed)) {
    throw new TypeError(`${field} is invalid.`);
  }
  return parsed;
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new TypeError(`${field} must be a positive integer.`);
  }
  return value as number;
}

function inferredAdapterSettings(
  provider: ImageUnderstandingOcrProvider,
  glm: StoredSettingsValue["glm"],
  paddle: StoredSettingsValue["paddle"],
): StoredSettingsValue["ocrAdapter"] {
  const presetId = inferOcrAdapterPreset(
    provider,
    provider === "glm-ocr" ? glm.model : paddle.model,
  );
  const preset = getOcrAdapterPreset(presetId);
  const selected = provider === "glm-ocr" ? glm : paddle;
  return {
    preset: presetId,
    source: preset.source,
    endpoint: selected.endpoint,
    model: selected.model,
    pollIntervalMs: provider === "paddleocr" ? paddle.pollIntervalMs : preset.pollIntervalMs,
    pollTimeoutMs: provider === "paddleocr" ? paddle.pollTimeoutMs : preset.pollTimeoutMs,
  };
}

function parseAdapterSettings(
  value: unknown,
  fallback: StoredSettingsValue["ocrAdapter"],
): StoredSettingsValue["ocrAdapter"] {
  if (value === undefined) return fallback;
  if (!isObject(value)) throw new TypeError("settings.ocrAdapter must be an object.");
  if (!OCR_ADAPTER_PRESET_VALUES.has(value.preset as OcrAdapterPresetId)) {
    throw new TypeError("settings.ocrAdapter.preset is invalid.");
  }
  const source = nonEmptyString(value.source, "settings.ocrAdapter.source", 100_000);
  const definition = parseOcrAdapterSource(source);
  const preset = value.preset as OcrAdapterPresetId;
  const presetDefinition = preset === "custom" ? undefined : getOcrAdapterPreset(preset);
  if (
    presetDefinition !== undefined &&
    serializeOcrAdapterSource(definition) !== presetDefinition.source
  ) {
    throw new TypeError("settings.ocrAdapter.source does not match its preset definition.");
  }
  return {
    preset,
    source: presetDefinition?.source ?? source,
    endpoint: endpoint(value.endpoint, "settings.ocrAdapter.endpoint"),
    model: nonEmptyString(value.model, "settings.ocrAdapter.model", 256),
    pollIntervalMs: positiveInteger(value.pollIntervalMs, "settings.ocrAdapter.pollIntervalMs"),
    pollTimeoutMs: positiveInteger(value.pollTimeoutMs, "settings.ocrAdapter.pollTimeoutMs"),
  };
}

function parseSettings(value: unknown): StoredSettingsValue {
  if (!isObject(value)) throw new TypeError("settings must be an object.");
  if (!ROUTING_VALUES.has(value.routing as ImageUnderstandingRouting)) {
    throw new TypeError("settings.routing is invalid.");
  }
  if (!ENGINE_VALUES.has(value.engine as ImageUnderstandingEngine)) {
    throw new TypeError("settings.engine is invalid.");
  }
  if (!OCR_PROVIDER_VALUES.has(value.ocrProvider as ImageUnderstandingOcrProvider)) {
    throw new TypeError("settings.ocrProvider is invalid.");
  }
  if (!isObject(value.glm) || !isObject(value.paddle) || !isObject(value.multimodal)) {
    throw new TypeError("provider settings must be objects.");
  }
  const glm = {
    endpoint: endpoint(value.glm.endpoint, "settings.glm.endpoint"),
    model: nonEmptyString(value.glm.model, "settings.glm.model", 256),
  };
  const paddle = {
    endpoint: endpoint(value.paddle.endpoint, "settings.paddle.endpoint"),
    model: nonEmptyString(value.paddle.model, "settings.paddle.model", 256),
    pollIntervalMs: positiveInteger(value.paddle.pollIntervalMs, "settings.paddle.pollIntervalMs"),
    pollTimeoutMs: positiveInteger(value.paddle.pollTimeoutMs, "settings.paddle.pollTimeoutMs"),
  };
  const ocrProvider = value.ocrProvider as ImageUnderstandingOcrProvider;
  return {
    routing: value.routing as ImageUnderstandingRouting,
    engine: value.engine as ImageUnderstandingEngine,
    ocrProvider,
    glm,
    paddle,
    ocrAdapter: parseAdapterSettings(
      value.ocrAdapter,
      inferredAdapterSettings(ocrProvider, glm, paddle),
    ),
    multimodal: {
      provider: optionalProviderId(value.multimodal.provider, "settings.multimodal.provider"),
      model: optionalString(value.multimodal.model, "settings.multimodal.model"),
    },
  };
}

function parseSecrets(value: unknown): StoredDocumentV1["secrets"] {
  if (!isObject(value)) throw new TypeError("secrets must be an object.");
  const secrets: StoredDocumentV1["secrets"] = {};
  for (const provider of OCR_CREDENTIAL_SLOTS) {
    const secret = value[provider];
    if (secret === undefined) continue;
    secrets[provider] = nonEmptyString(secret, `secrets.${provider}`, 16_384);
  }
  if (Object.keys(value).some((key) => !OCR_CREDENTIAL_SLOTS.has(key as OcrCredentialSlot))) {
    throw new TypeError("secrets contains an unknown provider.");
  }
  return secrets;
}

function defaultDocument(): StoredDocumentV1 {
  return {
    version: 1,
    revision: 0,
    settings: {
      ...DEFAULT_IMAGE_UNDERSTANDING_SETTINGS,
      glm: { ...DEFAULT_IMAGE_UNDERSTANDING_SETTINGS.glm },
      paddle: { ...DEFAULT_IMAGE_UNDERSTANDING_SETTINGS.paddle },
      ocrAdapter: { ...DEFAULT_IMAGE_UNDERSTANDING_SETTINGS.ocrAdapter },
      multimodal: { ...DEFAULT_IMAGE_UNDERSTANDING_SETTINGS.multimodal },
    },
    secrets: {},
  };
}

function parseDocument(content: string): StoredDocumentV1 {
  const parsed: unknown = JSON.parse(content);
  if (!isObject(parsed) || parsed.version !== 1) {
    throw new TypeError("image understanding settings version is unsupported.");
  }
  return {
    version: 1,
    revision: positiveIntegerOrZero(parsed.revision, "revision"),
    settings: parseSettings(parsed.settings),
    secrets: parseSecrets(parsed.secrets),
  };
}

function positiveIntegerOrZero(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${field} must be a non-negative integer.`);
  }
  return value as number;
}

function serialized(document: StoredDocumentV1): string {
  return `${JSON.stringify(document, undefined, 2)}\n`;
}

function credentialSlotForAdapter(adapter: StoredSettingsValue["ocrAdapter"]): OcrCredentialSlot {
  if (adapter.preset !== "custom") return getOcrAdapterPreset(adapter.preset).credentialSlot;
  const id = parseOcrAdapterSource(adapter.source).id.toLowerCase();
  if (id === "glm-ocr" || id.startsWith("glm-")) return "glm-ocr";
  if (id.includes("paddle") || id.startsWith("pp-")) return "paddleocr";
  return "custom";
}

function describeDocument(document: StoredDocumentV1): ImageUnderstandingDescribeValue {
  return {
    revision: document.revision,
    value: {
      ...document.settings,
      glm: {
        ...document.settings.glm,
        credentialConfigured: document.secrets["glm-ocr"] !== undefined,
      },
      paddle: {
        ...document.settings.paddle,
        credentialConfigured: document.secrets.paddleocr !== undefined,
      },
      ocrAdapter: {
        ...document.settings.ocrAdapter,
        credentialConfigured:
          document.secrets[credentialSlotForAdapter(document.settings.ocrAdapter)] !== undefined,
      },
    },
  };
}

function mergeSettings(
  current: StoredSettingsValue,
  patch: ImageUnderstandingSettingsPatch,
): StoredSettingsValue {
  const legacy: Omit<StoredSettingsValue, "ocrAdapter"> = {
    routing: patch.routing ?? current.routing,
    engine: patch.engine ?? current.engine,
    ocrProvider: patch.ocrProvider ?? current.ocrProvider,
    glm: {
      endpoint: patch.glm?.endpoint ?? current.glm.endpoint,
      model: patch.glm?.model ?? current.glm.model,
    },
    paddle: {
      endpoint: patch.paddle?.endpoint ?? current.paddle.endpoint,
      model: patch.paddle?.model ?? current.paddle.model,
      pollIntervalMs: patch.paddle?.pollIntervalMs ?? current.paddle.pollIntervalMs,
      pollTimeoutMs: patch.paddle?.pollTimeoutMs ?? current.paddle.pollTimeoutMs,
    },
    multimodal: {
      provider: patch.multimodal?.provider ?? current.multimodal.provider,
      model: patch.multimodal?.model ?? current.multimodal.model,
    },
  };
  let adapter = current.ocrAdapter;
  if (patch.ocrAdapter !== undefined) {
    const requestedPreset = patch.ocrAdapter.preset;
    const presetBase =
      requestedPreset !== undefined && requestedPreset !== "custom"
        ? getOcrAdapterPreset(requestedPreset)
        : undefined;
    const source = patch.ocrAdapter.source ?? presetBase?.source ?? adapter.source;
    const exactPreset = OCR_ADAPTER_PRESETS.find((candidate) => candidate.source === source)?.id;
    const preset = requestedPreset ?? exactPreset ?? "custom";
    adapter = {
      preset,
      source,
      endpoint: patch.ocrAdapter.endpoint ?? presetBase?.endpoint ?? adapter.endpoint,
      model: patch.ocrAdapter.model ?? presetBase?.model ?? adapter.model,
      pollIntervalMs:
        patch.ocrAdapter.pollIntervalMs ?? presetBase?.pollIntervalMs ?? adapter.pollIntervalMs,
      pollTimeoutMs:
        patch.ocrAdapter.pollTimeoutMs ?? presetBase?.pollTimeoutMs ?? adapter.pollTimeoutMs,
    };
  } else if (
    patch.ocrProvider !== undefined ||
    patch.glm !== undefined ||
    patch.paddle !== undefined
  ) {
    adapter = inferredAdapterSettings(legacy.ocrProvider, legacy.glm, legacy.paddle);
  }
  const candidate: StoredSettingsValue = { ...legacy, ocrAdapter: adapter };
  return parseSettings(candidate);
}

function applySecretPatch(
  secrets: StoredDocumentV1["secrets"],
  provider: OcrCredentialSlot,
  value: string | null | undefined,
): void {
  if (value === undefined || (typeof value === "string" && value.trim() === "")) return;
  if (value === null) {
    delete secrets[provider];
    return;
  }
  secrets[provider] = nonEmptyString(value, `${provider} credential`, 16_384);
}

export class ImageUnderstandingSettingsStore {
  readonly stateFile: string;

  constructor(options: ImageUnderstandingSettingsStoreOptions = {}) {
    this.stateFile =
      options.stateFile ?? path.join(getAgentDir(), "workbench", "image-understanding.json");
  }

  private async readOptional(): Promise<string | undefined> {
    try {
      return await readFile(this.stateFile, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  private async snapshot(): Promise<StoreSnapshot> {
    const content = await this.readOptional();
    return { document: content === undefined ? defaultDocument() : parseDocument(content) };
  }

  private async writeDocument(document: StoredDocumentV1): Promise<void> {
    await atomicReplaceFile(this.stateFile, serialized(document), {
      directoryMode: 0o700,
      enforceFileModeAfterReplace: true,
    });
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    return withCrossProcessFileLock(
      {
        lockDirectory: `${this.stateFile}.workbench-lock`,
        parentDirectoryMode: 0o700,
      },
      operation,
    );
  }

  async describe(): Promise<ImageUnderstandingDescribeValue> {
    try {
      return describeDocument((await this.snapshot()).document);
    } catch (error) {
      throw new ImageUnderstandingSettingsStoreError(
        error instanceof TypeError || error instanceof SyntaxError
          ? "image-settings-invalid"
          : "image-settings-io",
      );
    }
  }

  async resolveCredential(provider: ImageUnderstandingOcrProvider): Promise<string | undefined> {
    if (!OCR_PROVIDER_VALUES.has(provider)) {
      throw new ImageUnderstandingSettingsStoreError("image-settings-invalid");
    }
    try {
      return (await this.snapshot()).document.secrets[provider];
    } catch (error) {
      throw new ImageUnderstandingSettingsStoreError(
        error instanceof TypeError || error instanceof SyntaxError
          ? "image-settings-invalid"
          : "image-settings-io",
      );
    }
  }

  async resolveRuntimeSettings(): Promise<ImageUnderstandingRuntimeSettings> {
    try {
      const { document } = await this.snapshot();
      const described = describeDocument(document);
      const credential = document.secrets[credentialSlotForAdapter(document.settings.ocrAdapter)];
      return {
        ...described,
        ...(credential === undefined ? {} : { credential }),
      };
    } catch (error) {
      throw new ImageUnderstandingSettingsStoreError(
        error instanceof TypeError || error instanceof SyntaxError
          ? "image-settings-invalid"
          : "image-settings-io",
      );
    }
  }

  async update(payload: ImageUnderstandingUpdatePayload): Promise<ImageUnderstandingDescribeValue> {
    try {
      return await this.withLock(async () => {
        const { document: current } = await this.snapshot();
        if (
          payload.expectedRevision !== undefined &&
          payload.expectedRevision !== current.revision
        ) {
          throw new ImageUnderstandingSettingsStoreError("image-settings-conflict", {
            expectedRevision: payload.expectedRevision,
            actualRevision: current.revision,
          });
        }

        const settings = mergeSettings(current.settings, payload.patch);
        const secrets = { ...current.secrets };
        applySecretPatch(secrets, "glm-ocr", payload.patch.glm?.apiKey);
        applySecretPatch(secrets, "paddleocr", payload.patch.paddle?.apiKey);
        applySecretPatch(
          secrets,
          credentialSlotForAdapter(settings.ocrAdapter),
          payload.patch.ocrAdapter?.apiKey,
        );
        const unchanged =
          JSON.stringify(settings) === JSON.stringify(current.settings) &&
          JSON.stringify(secrets) === JSON.stringify(current.secrets);
        if (unchanged) return describeDocument(current);
        if (current.revision === Number.MAX_SAFE_INTEGER) {
          throw new TypeError("revision is exhausted");
        }
        const next: StoredDocumentV1 = {
          version: 1,
          revision: current.revision + 1,
          settings,
          secrets,
        };
        await this.writeDocument(next);
        return describeDocument(next);
      });
    } catch (error) {
      if (error instanceof ImageUnderstandingSettingsStoreError) throw error;
      if (error instanceof TypeError || error instanceof SyntaxError) {
        throw new ImageUnderstandingSettingsStoreError("image-settings-invalid");
      }
      throw new ImageUnderstandingSettingsStoreError("image-settings-io");
    }
  }
}
