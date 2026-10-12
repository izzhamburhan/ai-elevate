import assert from "node:assert/strict";
import test from "node:test";
import { localModelLabel, weatherDemoBasemap, weatherDemoChatModel } from "../src/lib/weather/demo.ts";

test("cached pitch uses the network-free basemap across both themes", () => {
  for (const theme of ["light", "dark"]) assert.equal(weatherDemoBasemap(theme, true), "no_map");
  assert.equal(weatherDemoBasemap("light", false), "positron");
  assert.equal(weatherDemoBasemap("dark", false), "dark-matter");
});

test("cached pitch selects the existing local model without changing normal defaults", () => {
  assert.equal(weatherDemoChatModel("openai/gpt-6.1-sol", true), "local/gemma4");
  assert.equal(weatherDemoChatModel("openai/gpt-6.1-sol", false), "openai/gpt-6.1-sol");
  assert.equal(localModelLabel("Qwen 3.5 9B (local)"), "Qwen 3.5 9B (local)");
  assert.equal(localModelLabel(" "), "Gemma 4 (local)");
});
