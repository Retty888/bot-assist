import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, "../../data");

export async function ensureDataDir(): Promise<string> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  return DATA_DIR;
}

export function resolveDataFile(fileName: string): string {
  return path.join(DATA_DIR, fileName);
}

export async function ensureDataFile(fileName: string, initialValue = ""): Promise<string> {
  const dir = await ensureDataDir();
  const fullPath = path.join(dir, fileName);
  try {
    await fs.access(fullPath);
  } catch {
    await fs.writeFile(fullPath, initialValue, { encoding: "utf8" });
  }
  return fullPath;
}

