import fs from "node:fs/promises";

import { ensureDataFile, resolveDataFile } from "./dataPaths.js";

export interface AppendOptions<T> {
  readonly fileName: string;
  readonly record: T;
}

export interface ReadOptions<T> {
  readonly fileName: string;
  readonly limit?: number;
  readonly mapper?: (item: unknown) => T | undefined;
}

export async function appendNdjsonRecord<T>({ fileName, record }: AppendOptions<T>): Promise<void> {
  const filePath = await ensureDataFile(fileName);
  const line = `${JSON.stringify(record)}\n`;
  await fs.appendFile(filePath, line, { encoding: "utf8" });
}

export async function readNdjsonRecords<T>({
  fileName,
  limit,
  mapper,
}: ReadOptions<T>): Promise<T[]> {
  const filePath = resolveDataFile(fileName);
  try {
    const content = await fs.readFile(filePath, { encoding: "utf8" });
    const lines = content.split(/\r?\n/).filter(Boolean);
    const mapped: T[] = [];
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      if (limit !== undefined && mapped.length >= limit) {
        break;
      }
      try {
        const parsed = JSON.parse(lines[index] ?? "{}");
        const value = mapper ? mapper(parsed) : (parsed as T);
        if (value !== undefined) {
          mapped.push(value);
        }
      } catch (error) {
        console.warn(`Failed to parse NDJSON line in ${fileName}:`, error);
      }
    }
    return mapped;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

