import assert from "node:assert/strict";
import test from "node:test";

import { modelProviderCredentialWebsite } from "./model-provider-credential-links";

test("returns direct credential pages for common built-in providers", () => {
  assert.equal(
    modelProviderCredentialWebsite({ kind: "built-in", provider: "openai" }),
    "https://platform.openai.com/api-keys",
  );
  assert.equal(
    modelProviderCredentialWebsite({ kind: "built-in", provider: "anthropic" }),
    "https://platform.claude.com/settings/keys",
  );
  assert.equal(
    modelProviderCredentialWebsite({ kind: "built-in", provider: "deepseek" }),
    "https://platform.deepseek.com/api_keys",
  );
});

test("maps regional aliases to their corresponding official platform", () => {
  assert.equal(
    modelProviderCredentialWebsite({ kind: "built-in", provider: "zai" }),
    "https://z.ai/manage-apikey/apikey-list",
  );
  assert.equal(
    modelProviderCredentialWebsite({ kind: "built-in", provider: "zai-coding-cn" }),
    "https://bigmodel.cn/usercenter/proj-mgmt/apikeys",
  );
});

test("does not guess a website for custom or unknown providers", () => {
  assert.equal(modelProviderCredentialWebsite({ kind: "custom", provider: "openai" }), undefined);
  assert.equal(
    modelProviderCredentialWebsite({ kind: "built-in", provider: "unknown-provider" }),
    undefined,
  );
  assert.equal(modelProviderCredentialWebsite(undefined), undefined);
});
