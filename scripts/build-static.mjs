import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");

const files = ["index.html", "styles.css", "app.js"];
const folders = ["assets", "data"];

async function resetDist() {
  await fs.rm(dist, { recursive: true, force: true });
  await fs.mkdir(dist, { recursive: true });
}

async function copyStaticFiles() {
  for (const file of files) {
    await fs.copyFile(path.join(root, file), path.join(dist, file));
  }

  for (const folder of folders) {
    await fs.cp(path.join(root, folder), path.join(dist, folder), {
      recursive: true,
      force: true
    });
  }
}

await resetDist();
await copyStaticFiles();
console.log(`Built ${path.relative(root, dist)} for Cloudflare deployment.`);
