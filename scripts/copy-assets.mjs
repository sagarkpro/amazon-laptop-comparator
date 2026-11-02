import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = join(scriptDirectory, "..");

await mkdir(join(root, "dist", "report", "assets"), { recursive: true });
await copyFile(
  join(root, "src", "report", "template.html"),
  join(root, "dist", "report", "template.html"),
);
await copyFile(
  join(root, "src", "report", "assets", "dashboard.css"),
  join(root, "dist", "report", "assets", "dashboard.css"),
);
await copyFile(
  join(root, "src", "report", "assets", "dashboard.js"),
  join(root, "dist", "report", "assets", "dashboard.js"),
);
await mkdir(join(root, "dist", "browser"), { recursive: true });
await copyFile(
  join(root, "src", "browser", "snapshot-page.txt"),
  join(root, "dist", "browser", "snapshot-page.txt"),
);
