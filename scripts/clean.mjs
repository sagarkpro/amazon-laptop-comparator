import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = join(scriptDirectory, "..");

await rm(join(root, "dist"), { recursive: true, force: true });
await rm(join(root, "output"), { recursive: true, force: true });
