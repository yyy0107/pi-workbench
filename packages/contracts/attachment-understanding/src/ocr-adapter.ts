/** Declarative, JSON-safe OCR adapter contract shared across Workbench runtimes. */
export const OCR_ADAPTER_SOURCE_PREFIX = "export default defineOcrAdapter(";
export const OCR_ADAPTER_SOURCE_SUFFIX = ");";

export const OCR_ADAPTER_PRESET_IDS = [
  "glm-ocr",
  "paddleocr-vl-1.6",
  "pp-ocrv6",
  "pp-structure-v3",
  "custom",
] as const;

export type OcrAdapterPresetId = (typeof OCR_ADAPTER_PRESET_IDS)[number];
export type OcrAdapterAttachmentKind = "image" | "pdf";
export type OcrAdapterOutputFormat = "markdown" | "text";

export type OcrAdapterTemplateValue =
  | null
  | boolean
  | number
  | string
  | OcrAdapterTemplateValue[]
  | { [key: string]: OcrAdapterTemplateValue };

export interface OcrAdapterAuthenticationV1 {
  header: string;
  prefix: string;
}

export interface OcrAdapterJsonRequestV1 {
  kind: "json";
  body: Record<string, OcrAdapterTemplateValue>;
}

export interface OcrAdapterMultipartFieldV1 {
  name: string;
  value: OcrAdapterTemplateValue;
  encoding?: "text" | "json";
}

export interface OcrAdapterMultipartRequestV1 {
  kind: "multipart";
  fileField: string;
  fields: OcrAdapterMultipartFieldV1[];
}

export interface OcrAdapterOutputRuleV1 {
  /** A bounded dot path. Append `[]` to flatten arrays, for example `pages[].text`. */
  path: string;
  format: OcrAdapterOutputFormat;
}

export interface OcrAdapterOutputV1 {
  strategy: "first-non-empty";
  rules: OcrAdapterOutputRuleV1[];
}

export interface OcrAdapterApiErrorRuleV1 {
  values: Array<string | number>;
  errorCode:
    | "provider-authentication-failed"
    | "provider-configuration-invalid"
    | "provider-rate-limited"
    | "provider-unavailable"
    | "provider-job-failed"
    | "provider-invalid-input"
    | "provider-invalid-response";
  retryable?: boolean;
}

export interface OcrAdapterApiEnvelopeV1 {
  codePath: string;
  successValues: Array<string | number>;
  errors: OcrAdapterApiErrorRuleV1[];
}

export interface OcrAdapterSyncOperationV1 {
  kind: "sync";
  output: OcrAdapterOutputV1;
}

export interface OcrAdapterResultSourceV1 {
  path: string;
  encoding: "jsonl" | "text";
  format?: OcrAdapterOutputFormat;
  output?: OcrAdapterOutputV1;
}

export interface OcrAdapterAsyncOperationV1 {
  kind: "async-job";
  jobIdPath: string;
  pollPath: string;
  statePath: string;
  pendingStates: string[];
  completedStates: string[];
  failedStates: string[];
  resultSources: OcrAdapterResultSourceV1[];
}

export interface OcrAdapterDefinitionV1 {
  version: 1;
  id: string;
  label: string;
  accepts: OcrAdapterAttachmentKind[];
  authentication: OcrAdapterAuthenticationV1;
  request: OcrAdapterJsonRequestV1 | OcrAdapterMultipartRequestV1;
  api?: OcrAdapterApiEnvelopeV1;
  operation: OcrAdapterSyncOperationV1 | OcrAdapterAsyncOperationV1;
  retry?: {
    maxAttempts: number;
    initialDelayMs: number;
    maxDelayMs: number;
  };
}

export interface OcrAdapterPreset {
  id: Exclude<OcrAdapterPresetId, "custom">;
  definition: OcrAdapterDefinitionV1;
  source: string;
  endpoint: string;
  model: string;
  pollIntervalMs: number;
  pollTimeoutMs: number;
  credentialSlot: "glm-ocr" | "paddleocr";
}

/** Type-checking identity for authored adapters. Stored settings are still parsed, never evaluated. */
export function defineOcrAdapter<const TDefinition extends OcrAdapterDefinitionV1>(
  definition: TDefinition,
): TDefinition {
  return definition;
}

type JsonObject = Record<string, unknown>;

const IDENTIFIER = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/;
const FIELD_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const PATH_SEGMENT = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\[\])*$/;
const PROVIDER_ERROR_CODES = new Set([
  "provider-authentication-failed",
  "provider-configuration-invalid",
  "provider-rate-limited",
  "provider-unavailable",
  "provider-job-failed",
  "provider-invalid-input",
  "provider-invalid-response",
]);

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: JsonObject, allowed: readonly string[], field: string): void {
  const allowedSet = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedSet.has(key))) {
    throw new TypeError(`${field} contains an unsupported property.`);
  }
}

function stringValue(value: unknown, field: string, maximum = 2_048): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new TypeError(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function boundedInteger(value: unknown, field: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new TypeError(`${field} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value as number;
}

function stringArray(value: unknown, field: string, maximum = 32): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > maximum) {
    throw new TypeError(`${field} must be a non-empty array.`);
  }
  return value.map((item, index) => stringValue(item, `${field}[${index}]`, 128));
}

function scalarArray(value: unknown, field: string): Array<string | number> {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) {
    throw new TypeError(`${field} must be a non-empty array.`);
  }
  return value.map((item, index) => {
    if (
      (typeof item !== "string" || item.length > 128) &&
      (typeof item !== "number" || !Number.isSafeInteger(item))
    ) {
      throw new TypeError(`${field}[${index}] must be a short string or integer.`);
    }
    return item;
  });
}

function pathValue(value: unknown, field: string): string {
  const parsed = stringValue(value, field, 512);
  const segments = parsed.split(".");
  if (
    segments.length > 32 ||
    segments.some((segment) => {
      const name = segment.replace(/(?:\[\])+$/g, "");
      return (
        !PATH_SEGMENT.test(segment) || ["__proto__", "prototype", "constructor"].includes(name)
      );
    })
  ) {
    throw new TypeError(`${field} must be a bounded dot path.`);
  }
  return parsed;
}

function parseTemplateValue(value: unknown, field: string, depth = 0): OcrAdapterTemplateValue {
  if (depth > 12) throw new TypeError(`${field} is nested too deeply.`);
  if (
    value === null ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  if (typeof value === "string") {
    if (value.length > 16_384) throw new TypeError(`${field} is too long.`);
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 128) throw new TypeError(`${field} contains too many values.`);
    return value.map((item, index) => parseTemplateValue(item, `${field}[${index}]`, depth + 1));
  }
  if (isObject(value)) {
    const entries = Object.entries(value);
    if (entries.length > 128) throw new TypeError(`${field} contains too many properties.`);
    return Object.fromEntries(
      entries.map(([key, item]) => {
        if (!FIELD_NAME.test(key) || ["__proto__", "prototype", "constructor"].includes(key)) {
          throw new TypeError(`${field} contains an invalid key.`);
        }
        return [key, parseTemplateValue(item, `${field}.${key}`, depth + 1)];
      }),
    );
  }
  throw new TypeError(`${field} contains an unsupported value.`);
}

function parseOutput(value: unknown, field: string): OcrAdapterOutputV1 {
  if (!isObject(value)) throw new TypeError(`${field} must be an object.`);
  exactKeys(value, ["strategy", "rules"], field);
  if (value.strategy !== "first-non-empty") {
    throw new TypeError(`${field}.strategy is unsupported.`);
  }
  if (!Array.isArray(value.rules) || value.rules.length === 0 || value.rules.length > 32) {
    throw new TypeError(`${field}.rules must be a non-empty array.`);
  }
  return {
    strategy: "first-non-empty",
    rules: value.rules.map((rule, index) => {
      const ruleField = `${field}.rules[${index}]`;
      if (!isObject(rule)) throw new TypeError(`${ruleField} must be an object.`);
      exactKeys(rule, ["path", "format"], ruleField);
      if (rule.format !== "markdown" && rule.format !== "text") {
        throw new TypeError(`${ruleField}.format is invalid.`);
      }
      return { path: pathValue(rule.path, `${ruleField}.path`), format: rule.format };
    }),
  };
}

function parseApi(value: unknown): OcrAdapterApiEnvelopeV1 | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value)) throw new TypeError("adapter.api must be an object.");
  exactKeys(value, ["codePath", "successValues", "errors"], "adapter.api");
  if (!Array.isArray(value.errors) || value.errors.length > 64) {
    throw new TypeError("adapter.api.errors must be an array.");
  }
  return {
    codePath: pathValue(value.codePath, "adapter.api.codePath"),
    successValues: scalarArray(value.successValues, "adapter.api.successValues"),
    errors: value.errors.map((rule, index) => {
      const field = `adapter.api.errors[${index}]`;
      if (!isObject(rule)) throw new TypeError(`${field} must be an object.`);
      exactKeys(rule, ["values", "errorCode", "retryable"], field);
      if (!PROVIDER_ERROR_CODES.has(rule.errorCode as string)) {
        throw new TypeError(`${field}.errorCode is invalid.`);
      }
      if (rule.retryable !== undefined && typeof rule.retryable !== "boolean") {
        throw new TypeError(`${field}.retryable must be a boolean.`);
      }
      return {
        values: scalarArray(rule.values, `${field}.values`),
        errorCode: rule.errorCode as OcrAdapterApiErrorRuleV1["errorCode"],
        ...(rule.retryable === undefined ? {} : { retryable: rule.retryable }),
      };
    }),
  };
}

function parseDefinition(value: unknown): OcrAdapterDefinitionV1 {
  if (!isObject(value)) throw new TypeError("adapter must be an object.");
  exactKeys(
    value,
    ["version", "id", "label", "accepts", "authentication", "request", "api", "operation", "retry"],
    "adapter",
  );
  if (value.version !== 1) throw new TypeError("adapter.version must be 1.");
  const id = stringValue(value.id, "adapter.id", 128);
  if (!IDENTIFIER.test(id)) throw new TypeError("adapter.id is invalid.");
  const accepts = stringArray(value.accepts, "adapter.accepts", 2);
  if (
    accepts.some((item) => item !== "image" && item !== "pdf") ||
    new Set(accepts).size !== accepts.length
  ) {
    throw new TypeError("adapter.accepts is invalid.");
  }
  if (!isObject(value.authentication)) {
    throw new TypeError("adapter.authentication must be an object.");
  }
  exactKeys(value.authentication, ["header", "prefix"], "adapter.authentication");
  const header = stringValue(value.authentication.header, "adapter.authentication.header", 128);
  if (!HEADER_NAME.test(header) || /^(?:host|content-length|content-type)$/i.test(header)) {
    throw new TypeError("adapter.authentication.header is invalid.");
  }
  const prefix =
    typeof value.authentication.prefix === "string" && value.authentication.prefix.length <= 64
      ? value.authentication.prefix
      : undefined;
  if (prefix === undefined || !/^(?:[A-Za-z][A-Za-z0-9._-]{0,31}[ \t]+)?$/.test(prefix)) {
    throw new TypeError("adapter.authentication.prefix is invalid.");
  }

  if (!isObject(value.request)) throw new TypeError("adapter.request must be an object.");
  let request: OcrAdapterDefinitionV1["request"];
  if (value.request.kind === "json") {
    exactKeys(value.request, ["kind", "body"], "adapter.request");
    if (!isObject(value.request.body))
      throw new TypeError("adapter.request.body must be an object.");
    request = {
      kind: "json",
      body: parseTemplateValue(value.request.body, "adapter.request.body") as Record<
        string,
        OcrAdapterTemplateValue
      >,
    };
  } else if (value.request.kind === "multipart") {
    exactKeys(value.request, ["kind", "fileField", "fields"], "adapter.request");
    const fileField = stringValue(value.request.fileField, "adapter.request.fileField", 128);
    if (!FIELD_NAME.test(fileField)) throw new TypeError("adapter.request.fileField is invalid.");
    if (!Array.isArray(value.request.fields) || value.request.fields.length > 64) {
      throw new TypeError("adapter.request.fields must be an array.");
    }
    request = {
      kind: "multipart",
      fileField,
      fields: value.request.fields.map((item, index) => {
        const field = `adapter.request.fields[${index}]`;
        if (!isObject(item)) throw new TypeError(`${field} must be an object.`);
        exactKeys(item, ["name", "value", "encoding"], field);
        const name = stringValue(item.name, `${field}.name`, 128);
        if (!FIELD_NAME.test(name) || name === fileField) {
          throw new TypeError(`${field}.name is invalid.`);
        }
        if (item.encoding !== undefined && item.encoding !== "text" && item.encoding !== "json") {
          throw new TypeError(`${field}.encoding is invalid.`);
        }
        return {
          name,
          value: parseTemplateValue(item.value, `${field}.value`),
          ...(item.encoding === undefined ? {} : { encoding: item.encoding }),
        };
      }),
    };
  } else {
    throw new TypeError("adapter.request.kind is invalid.");
  }

  if (!isObject(value.operation)) throw new TypeError("adapter.operation must be an object.");
  let operation: OcrAdapterDefinitionV1["operation"];
  if (value.operation.kind === "sync") {
    exactKeys(value.operation, ["kind", "output"], "adapter.operation");
    operation = {
      kind: "sync",
      output: parseOutput(value.operation.output, "adapter.operation.output"),
    };
  } else if (value.operation.kind === "async-job") {
    exactKeys(
      value.operation,
      [
        "kind",
        "jobIdPath",
        "pollPath",
        "statePath",
        "pendingStates",
        "completedStates",
        "failedStates",
        "resultSources",
      ],
      "adapter.operation",
    );
    const pollPath = stringValue(value.operation.pollPath, "adapter.operation.pollPath", 512);
    if (
      !pollPath.startsWith("/") ||
      !pollPath.includes("{jobId}") ||
      pollPath.replace("{jobId}", "").includes("{") ||
      /[?#]/.test(pollPath)
    ) {
      throw new TypeError("adapter.operation.pollPath is invalid.");
    }
    if (
      !Array.isArray(value.operation.resultSources) ||
      value.operation.resultSources.length === 0 ||
      value.operation.resultSources.length > 16
    ) {
      throw new TypeError("adapter.operation.resultSources must be a non-empty array.");
    }
    operation = {
      kind: "async-job",
      jobIdPath: pathValue(value.operation.jobIdPath, "adapter.operation.jobIdPath"),
      pollPath,
      statePath: pathValue(value.operation.statePath, "adapter.operation.statePath"),
      pendingStates: stringArray(value.operation.pendingStates, "adapter.operation.pendingStates"),
      completedStates: stringArray(
        value.operation.completedStates,
        "adapter.operation.completedStates",
      ),
      failedStates: stringArray(value.operation.failedStates, "adapter.operation.failedStates"),
      resultSources: value.operation.resultSources.map((source, index) => {
        const field = `adapter.operation.resultSources[${index}]`;
        if (!isObject(source)) throw new TypeError(`${field} must be an object.`);
        exactKeys(source, ["path", "encoding", "format", "output"], field);
        if (source.encoding !== "jsonl" && source.encoding !== "text") {
          throw new TypeError(`${field}.encoding is invalid.`);
        }
        if (
          source.format !== undefined &&
          source.format !== "markdown" &&
          source.format !== "text"
        ) {
          throw new TypeError(`${field}.format is invalid.`);
        }
        if (source.encoding === "jsonl" && source.output === undefined) {
          throw new TypeError(`${field}.output is required for JSONL.`);
        }
        return {
          path: pathValue(source.path, `${field}.path`),
          encoding: source.encoding,
          ...(source.format === undefined ? {} : { format: source.format }),
          ...(source.output === undefined
            ? {}
            : { output: parseOutput(source.output, `${field}.output`) }),
        };
      }),
    };
  } else {
    throw new TypeError("adapter.operation.kind is invalid.");
  }

  let retry: OcrAdapterDefinitionV1["retry"];
  if (value.retry !== undefined) {
    if (!isObject(value.retry)) throw new TypeError("adapter.retry must be an object.");
    exactKeys(value.retry, ["maxAttempts", "initialDelayMs", "maxDelayMs"], "adapter.retry");
    retry = {
      maxAttempts: boundedInteger(value.retry.maxAttempts, "adapter.retry.maxAttempts", 1, 10),
      initialDelayMs: boundedInteger(
        value.retry.initialDelayMs,
        "adapter.retry.initialDelayMs",
        100,
        60_000,
      ),
      maxDelayMs: boundedInteger(value.retry.maxDelayMs, "adapter.retry.maxDelayMs", 100, 120_000),
    };
    if (retry.maxDelayMs < retry.initialDelayMs) {
      throw new TypeError("adapter.retry.maxDelayMs must not be smaller than initialDelayMs.");
    }
  }

  const api = parseApi(value.api);
  return {
    version: 1,
    id,
    label: stringValue(value.label, "adapter.label", 128),
    accepts: accepts as OcrAdapterAttachmentKind[],
    authentication: { header, prefix },
    request,
    ...(api === undefined ? {} : { api }),
    operation,
    ...(retry === undefined ? {} : { retry }),
  };
}

export function serializeOcrAdapterSource(definition: OcrAdapterDefinitionV1): string {
  return `${OCR_ADAPTER_SOURCE_PREFIX}\n/**
 * Workbench OCR adapter contract (version 1).
 *
 * This source is parsed as declarative data and is never executed as JavaScript.
 * - accepts: attachment kinds handled by this adapter ("image" and/or "pdf").
 * - authentication: credential header and prefix; the API key is stored separately.
 * - request: JSON or multipart request template. Available placeholders are
 *   $model, $attachment.dataUrl, $attachment.base64, $attachment.name, and
 *   $attachment.mimeType.
 * - api: optional provider response-code mapping to stable Workbench errors.
 * - operation: synchronous output extraction or asynchronous job polling.
 * - retry: bounded retries for errors explicitly marked as retryable.
 *
 * Output paths use dot notation; append [] to flatten array values.
 */
${JSON.stringify(definition, undefined, 2)}
${OCR_ADAPTER_SOURCE_SUFFIX}`;
}

function stripOcrAdapterSourceComments(source: string): string {
  type State = "code" | "string" | "line-comment" | "block-comment";

  let state: State = "code";
  let escaped = false;
  let result = "";

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    const next = source[index + 1];

    if (state === "string") {
      result += character;
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        state = "code";
      }
      continue;
    }

    if (state === "line-comment") {
      if (
        character === "\n" ||
        character === "\r" ||
        character === "\u2028" ||
        character === "\u2029"
      ) {
        result += character;
        state = "code";
      } else {
        result += " ";
      }
      continue;
    }

    if (state === "block-comment") {
      if (character === "*" && next === "/") {
        result += "  ";
        index += 1;
        state = "code";
      } else if (
        character === "\n" ||
        character === "\r" ||
        character === "\u2028" ||
        character === "\u2029"
      ) {
        result += character;
      } else {
        result += " ";
      }
      continue;
    }

    if (character === '"') {
      result += character;
      state = "string";
    } else if (character === "/" && next === "/") {
      result += "  ";
      index += 1;
      state = "line-comment";
    } else if (character === "/" && next === "*") {
      result += "  ";
      index += 1;
      state = "block-comment";
    } else {
      result += character;
    }
  }

  if (state === "block-comment") {
    throw new TypeError("OCR adapter source contains an unterminated block comment.");
  }
  return result;
}

export function parseOcrAdapterSource(source: string): OcrAdapterDefinitionV1 {
  if (typeof source !== "string" || source.length === 0 || source.length > 100_000) {
    throw new TypeError("OCR adapter source must be between 1 and 100000 characters.");
  }
  const trimmed = source.trim();
  if (
    !trimmed.startsWith(OCR_ADAPTER_SOURCE_PREFIX) ||
    !trimmed.endsWith(OCR_ADAPTER_SOURCE_SUFFIX)
  ) {
    throw new TypeError(
      `OCR adapter source must use ${OCR_ADAPTER_SOURCE_PREFIX} … ${OCR_ADAPTER_SOURCE_SUFFIX}`,
    );
  }
  const json = trimmed.slice(OCR_ADAPTER_SOURCE_PREFIX.length, -OCR_ADAPTER_SOURCE_SUFFIX.length);
  return parseDefinition(JSON.parse(stripOcrAdapterSourceComments(json)));
}

const PADDLE_API = {
  codePath: "code",
  successValues: [0],
  errors: [
    { values: [401], errorCode: "provider-authentication-failed" },
    { values: [500], errorCode: "provider-unavailable", retryable: true },
    {
      values: [10001, 10002, 10003, 10004, 10005, 10006],
      errorCode: "provider-invalid-input",
    },
    { values: [10007, 10008], errorCode: "provider-configuration-invalid" },
    { values: [12001], errorCode: "provider-rate-limited" },
    { values: [10010, 12002], errorCode: "provider-rate-limited", retryable: true },
    { values: [11003], errorCode: "provider-job-failed" },
  ],
} satisfies OcrAdapterApiEnvelopeV1;

function paddleDefinition(
  id: string,
  label: string,
  optionalPayload: Record<string, boolean>,
  output: OcrAdapterOutputV1,
): OcrAdapterDefinitionV1 {
  return {
    version: 1,
    id,
    label,
    accepts: ["image", "pdf"],
    authentication: { header: "Authorization", prefix: "Bearer " },
    request: {
      kind: "multipart",
      fileField: "file",
      fields: [
        { name: "model", value: "$model" },
        { name: "optionalPayload", value: optionalPayload, encoding: "json" },
      ],
    },
    api: PADDLE_API,
    operation: {
      kind: "async-job",
      jobIdPath: "data.jobId",
      pollPath: "/{jobId}",
      statePath: "data.state",
      pendingStates: ["pending", "running"],
      completedStates: ["done"],
      failedStates: ["failed"],
      resultSources: [
        { path: "data.resultUrl.jsonUrl", encoding: "jsonl", output },
        { path: "data.resultUrl.markdownUrl", encoding: "text", format: "markdown" },
      ],
    },
    retry: { maxAttempts: 4, initialDelayMs: 3_000, maxDelayMs: 12_000 },
  };
}

const GLM_DEFINITION: OcrAdapterDefinitionV1 = {
  version: 1,
  id: "glm-ocr",
  label: "GLM-OCR",
  accepts: ["image", "pdf"],
  authentication: { header: "Authorization", prefix: "Bearer " },
  request: {
    kind: "json",
    body: {
      model: "$model",
      file: "$attachment.dataUrl",
      return_crop_images: false,
      need_layout_visualization: false,
    },
  },
  operation: {
    kind: "sync",
    output: {
      strategy: "first-non-empty",
      rules: [
        { path: "md_results", format: "markdown" },
        { path: "markdown_result", format: "markdown" },
        { path: "json_result.text", format: "text" },
        { path: "layout_details[][].content", format: "text" },
      ],
    },
  },
};

const PADDLE_LAYOUT_OUTPUT: OcrAdapterOutputV1 = {
  strategy: "first-non-empty",
  rules: [{ path: "result.layoutParsingResults[].markdown.text", format: "markdown" }],
};

const PADDLE_OCR_OUTPUT: OcrAdapterOutputV1 = {
  strategy: "first-non-empty",
  rules: [
    { path: "result.ocrResults[].prunedResult.rec_texts[]", format: "text" },
    { path: "result.ocrResults[].prunedResult.blocks[].content", format: "text" },
  ],
};

const PRESET_DATA: ReadonlyArray<Omit<OcrAdapterPreset, "source">> = [
  {
    id: "glm-ocr",
    definition: GLM_DEFINITION,
    endpoint: "https://api.z.ai/api/paas/v4/layout_parsing",
    model: "glm-ocr",
    pollIntervalMs: 3_000,
    pollTimeoutMs: 600_000,
    credentialSlot: "glm-ocr",
  },
  {
    id: "paddleocr-vl-1.6",
    definition: paddleDefinition(
      "paddleocr-vl-1.6",
      "PaddleOCR-VL-1.6",
      {
        useDocOrientationClassify: false,
        useDocUnwarping: false,
        useChartRecognition: false,
      },
      PADDLE_LAYOUT_OUTPUT,
    ),
    endpoint: "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs",
    model: "PaddleOCR-VL-1.6",
    pollIntervalMs: 3_000,
    pollTimeoutMs: 600_000,
    credentialSlot: "paddleocr",
  },
  {
    id: "pp-ocrv6",
    definition: paddleDefinition(
      "pp-ocrv6",
      "PP-OCRv6",
      {
        useDocOrientationClassify: false,
        useDocUnwarping: false,
        useTextlineOrientation: false,
      },
      PADDLE_OCR_OUTPUT,
    ),
    endpoint: "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs",
    model: "PP-OCRv6",
    pollIntervalMs: 3_000,
    pollTimeoutMs: 600_000,
    credentialSlot: "paddleocr",
  },
  {
    id: "pp-structure-v3",
    definition: paddleDefinition(
      "pp-structure-v3",
      "PP-StructureV3",
      {
        useDocOrientationClassify: false,
        useDocUnwarping: false,
        useChartRecognition: false,
      },
      PADDLE_LAYOUT_OUTPUT,
    ),
    endpoint: "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs",
    model: "PP-StructureV3",
    pollIntervalMs: 3_000,
    pollTimeoutMs: 600_000,
    credentialSlot: "paddleocr",
  },
];

export const OCR_ADAPTER_PRESETS: readonly OcrAdapterPreset[] = Object.freeze(
  PRESET_DATA.map((preset) =>
    Object.freeze({ ...preset, source: serializeOcrAdapterSource(preset.definition) }),
  ),
);

export function getOcrAdapterPreset(id: Exclude<OcrAdapterPresetId, "custom">): OcrAdapterPreset {
  const preset = OCR_ADAPTER_PRESETS.find((candidate) => candidate.id === id);
  if (!preset) throw new TypeError(`Unknown OCR adapter preset: ${id}`);
  return preset;
}

export function inferOcrAdapterPreset(
  provider: "glm-ocr" | "paddleocr",
  model: string,
): Exclude<OcrAdapterPresetId, "custom"> {
  if (provider === "glm-ocr") return "glm-ocr";
  if (model.trim().toLowerCase() === "pp-ocrv6") return "pp-ocrv6";
  if (model.trim().toLowerCase() === "pp-structurev3") return "pp-structure-v3";
  return "paddleocr-vl-1.6";
}
