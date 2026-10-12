#!/usr/bin/env node
// Ranks the questions the assistant couldn't answer (npm run gaps), to pick the next tools to build.
// Reads the log the chat's report_capability_gap tool writes: .data/capability-gaps.jsonl, or CAPABILITY_GAPS_LOG.
// Gaps logged while a connector was offline are listed apart: starting that server may be the whole fix.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const log = process.env.CAPABILITY_GAPS_LOG ?? path.join(process.cwd(), ".data", "capability-gaps.jsonl");
if (!existsSync(log)) {
  console.log(`No gaps logged yet (${log}).`);
  process.exit(0);
}

const gaps = readFileSync(log, "utf8")
  .split("\n")
  .filter(Boolean)
  .flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });

/** Groups by what was needed; the model words it freely, so case and punctuation are ignored. */
function rank(entries) {
  const groups = new Map();
  for (const gap of entries) {
    const key = `${gap.kind}|${gap.needed.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()}`;
    const group = groups.get(key) ?? { kind: gap.kind, needed: gap.needed, count: 0, last: gap };
    group.count += 1;
    if (gap.at > group.last.at) group.last = gap;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

function print(title, entries) {
  if (entries.length === 0) return;
  console.log(`\n${title} (${entries.length})`);
  for (const g of rank(entries)) {
    console.log(`  ${String(g.count).padStart(3)}  [${g.kind}] ${g.needed}`);
    console.log(`       e.g. "${g.last.request}" (${g.last.at.slice(0, 10)})`);
  }
}

const offline = gaps.filter((g) => g.offline?.length);
print("Missing capabilities", gaps.filter((g) => !g.offline?.length));
print("Logged while connectors were offline", offline);

if (offline.length) {
  const counts = new Map();
  for (const name of offline.flatMap((g) => g.offline)) counts.set(name, (counts.get(name) ?? 0) + 1);
  console.log(`\n  offline: ${[...counts].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n} ×${c}`).join(", ")}`);
}
