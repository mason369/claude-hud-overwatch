#!/usr/bin/env node
import { readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import {
  loadEnabledSessionIds,
  extractSessionId,
  classifySession,
} from "./classifier.js";
import { computeMetrics, loadEvents, countViolations } from "./metrics.js";
import { buildReport } from "./report.js";

async function walkJsonl(dir, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkJsonl(full, out);
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      out.push(full);
    }
  }
  return out;
}

async function main() {
  const home = os.homedir();
  const projectsDir = path.join(home, ".claude", "projects");
  const eventsPath = path.join(home, ".claude", "logs", "harness-events.jsonl");

  console.log(`Scanning ${projectsDir} ...`);
  const transcripts = await walkJsonl(projectsDir);
  console.log(`Found ${transcripts.length} transcript(s)`);

  const enabledIds = await loadEnabledSessionIds(eventsPath);
  console.log(
    `Loaded ${enabledIds.size} enabled session id(s) from ${eventsPath}`,
  );

  const events = await loadEvents(eventsPath);

  const enabled = [];
  const disabled = [];
  let skipped = 0;

  for (const t of transcripts) {
    const sid = await extractSessionId(t);
    if (!sid) {
      skipped += 1;
      continue;
    }
    const metrics = await computeMetrics(t);
    if (!metrics) {
      skipped += 1;
      continue;
    }
    metrics.violations_per_session = countViolations(events, sid);
    const group = classifySession(sid, enabledIds);
    if (group === "enabled") enabled.push(metrics);
    else if (group === "disabled") disabled.push(metrics);
    else skipped += 1;
  }

  console.log(
    `Enabled: ${enabled.length}  Disabled: ${disabled.length}  Skipped: ${skipped}`,
  );

  const date = new Date().toISOString().slice(0, 10);
  const report = buildReport({ enabled, disabled, date });

  const outDir = path.dirname(fileURLToPath(import.meta.url));
  const outPath = path.join(outDir, `report-${date}.md`);
  await writeFile(outPath, report, "utf8");
  console.log(`Report written: ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
