import assert from "node:assert/strict";
import test from "node:test";

import {
  getOcrAdapterPreset,
  OCR_ADAPTER_PRESETS,
  parseOcrAdapterSource,
  serializeOcrAdapterSource,
} from "./ocr-adapter";

test("all built-in OCR adapter TypeScript templates round-trip through the strict parser", () => {
  for (const preset of OCR_ADAPTER_PRESETS) {
    assert.deepEqual(parseOcrAdapterSource(preset.source), preset.definition);
    assert.equal(serializeOcrAdapterSource(preset.definition), preset.source);
  }
});

test("built-in templates cover GLM and the three requested Paddle implementations", () => {
  assert.deepEqual(
    OCR_ADAPTER_PRESETS.map((preset) => [preset.id, preset.model]),
    [
      ["glm-ocr", "glm-ocr"],
      ["paddleocr-vl-1.6", "PaddleOCR-VL-1.6"],
      ["pp-ocrv6", "PP-OCRv6"],
      ["pp-structure-v3", "PP-StructureV3"],
    ],
  );
  assert.equal(getOcrAdapterPreset("pp-ocrv6").definition.operation.kind, "async-job");
});

test("the adapter source is declarative TypeScript and rejects executable code", () => {
  const valid = getOcrAdapterPreset("glm-ocr").source;
  assert.throws(() => parseOcrAdapterSource(`${valid}\nprocess.exit(1)`), TypeError);
  assert.throws(
    () =>
      parseOcrAdapterSource(
        valid.replace('"label": "GLM-OCR",', '"label": "GLM-OCR",\n  "execute": "process.exit",'),
      ),
    /unsupported property/,
  );
  assert.throws(
    () => parseOcrAdapterSource("export default (() => fetch('https://x'))();"),
    TypeError,
  );
});

test("the parser rejects unsafe auth headers, unbounded paths, and unknown versions", () => {
  const definition = structuredClone(getOcrAdapterPreset("glm-ocr").definition);
  definition.authentication.header = "Content-Length";
  assert.throws(() => parseOcrAdapterSource(serializeOcrAdapterSource(definition)), /header/);

  const badPath = structuredClone(getOcrAdapterPreset("glm-ocr").definition);
  if (badPath.operation.kind !== "sync") assert.fail("expected sync preset");
  badPath.operation.output.rules[0]!.path = "constructor.prototype";
  assert.throws(() => parseOcrAdapterSource(serializeOcrAdapterSource(badPath)), /dot path/);

  const badVersion = getOcrAdapterPreset("glm-ocr").source.replace('"version": 1', '"version": 2');
  assert.throws(() => parseOcrAdapterSource(badVersion), /version/);
});
