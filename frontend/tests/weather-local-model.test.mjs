import assert from "node:assert/strict";
import test from "node:test";
import { configureLocalModel } from "../src/lib/ai/local-model.ts";

test("local reasoning remains opt-in and preserves other provider options", async () => {
  const calls = [];
  const model = {
    specificationVersion: "v4", provider: "local.chat", modelId: "fabricated-test-model", supportedUrls: {},
    async doGenerate(options) { calls.push(options); return {}; },
    async doStream(options) { calls.push(options); return {}; },
  };
  assert.equal(configureLocalModel(model), model);
  assert.equal(configureLocalModel(model, " "), model);
  const configured = configureLocalModel(model, "none");
  await configured.doGenerate({ prompt: [], providerOptions: { unrelated: { fixture: true } } });
  assert.equal(calls[0].providerOptions.local.reasoningEffort, "none");
  assert.deepEqual(calls[0].providerOptions.unrelated, { fixture: true });
  await configured.doStream({ prompt: [], providerOptions: { local: { reasoningEffort: "high" } } });
  assert.equal(calls[1].providerOptions.local.reasoningEffort, "high");
});
