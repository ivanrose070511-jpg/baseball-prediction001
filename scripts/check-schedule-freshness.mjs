import { appendFile } from "node:fs/promises";

const backupSchedules = new Set([
  "20 6 * * 1-5",
  "20 3 * * 6,0",
  "0 15 * * *",
]);

let shouldRun = true;
let reason = "primary or manual run";

if (
  process.env.EVENT_NAME === "schedule" &&
  backupSchedules.has(process.env.EVENT_SCHEDULE)
) {
  try {
    const response = await fetch(
      `https://dawn-hill-de60.ivanrose070511.workers.dev/data/predictions.js?freshness=${Date.now()}`,
      { headers: { "cache-control": "no-cache" } },
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const source = await response.text();
    const match = source.match(/"generatedAt"\s*:\s*"([^"]+)"/);
    const generatedAt = match ? Date.parse(match[1]) : Number.NaN;
    const ageMinutes = (Date.now() - generatedAt) / 60_000;

    if (Number.isFinite(ageMinutes) && ageMinutes >= 0 && ageMinutes < 90) {
      shouldRun = false;
      reason = `public site is already fresh (${Math.round(ageMinutes)} minutes old)`;
    } else {
      reason = "public site is stale, so the backup will run";
    }
  } catch (error) {
    reason = `freshness check failed (${error.message}); backup will run`;
  }
}

console.log(`Schedule decision: ${shouldRun ? "run" : "skip"} - ${reason}`);

if (!process.env.GITHUB_OUTPUT) {
  throw new Error("GITHUB_OUTPUT is not available");
}

await appendFile(process.env.GITHUB_OUTPUT, `should_run=${shouldRun}\n`, "utf8");
