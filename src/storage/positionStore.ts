import crypto from "node:crypto";
import fs from "node:fs/promises";

import { ensureDataFile, resolveDataFile } from "./dataPaths.js";

const POSITION_FILE = "positions.json";

export type PositionSide = "long" | "short";

export interface StoredPosition {
  readonly id: string;
  readonly symbol: string;
  readonly side: PositionSide;
  readonly size: number;
  readonly entryPrice: number;
  readonly stopLoss?: number;
  readonly takeProfit?: number;
  readonly tags?: readonly string[];
  readonly notes?: string;
  readonly source?: "test" | "live" | "manual";
  readonly updatedAt: number;
  readonly createdAt: number;
}

export type PositionInput = Omit<StoredPosition, "id" | "createdAt" | "updatedAt">;

const SEED_POSITIONS: PositionInput[] = [
  {
    symbol: "BTC",
    side: "long",
    size: 1.5,
    entryPrice: 60250,
    stopLoss: 58650,
    takeProfit: 63800,
    tags: ["test", "swing"],
    notes: "Demo position approximating swing entry.",
    source: "test",
  },
  {
    symbol: "ETH",
    side: "short",
    size: 4,
    entryPrice: 3520,
    stopLoss: 3665,
    takeProfit: 3200,
    tags: ["test", "momentum"],
    notes: "Momentum fade with trailing entries.",
    source: "test",
  },
];

async function readPositionsFromDisk(): Promise<StoredPosition[]> {
  const filePath = resolveDataFile(POSITION_FILE);
  try {
    const content = await fs.readFile(filePath, { encoding: "utf8" });
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      return parsed as StoredPosition[];
    }
    return [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function writePositionsToDisk(positions: StoredPosition[]): Promise<void> {
  const filePath = await ensureDataFile(POSITION_FILE, "[]");
  await fs.writeFile(filePath, JSON.stringify(positions, null, 2), { encoding: "utf8" });
}

async function seedPositionsIfEmpty(current: StoredPosition[]): Promise<StoredPosition[]> {
  if (current.length > 0) {
    return current;
  }
  if (SEED_POSITIONS.length === 0) {
    return current;
  }
  const now = Date.now();
  const seeded = SEED_POSITIONS.map((position) => ({
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    ...position,
  } satisfies StoredPosition));
  await writePositionsToDisk(seeded);
  return seeded;
}

export async function listPositions(): Promise<StoredPosition[]> {
  const positions = await readPositionsFromDisk();
  return seedPositionsIfEmpty(positions);
}

export async function createPosition(input: PositionInput): Promise<StoredPosition> {
  const positions = await readPositionsFromDisk();
  const now = Date.now();
  const position: StoredPosition = {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    ...input,
  };
  positions.push(position);
  await writePositionsToDisk(positions);
  return position;
}

export async function updatePosition(id: string, patch: Partial<PositionInput>): Promise<StoredPosition | undefined> {
  const positions = await readPositionsFromDisk();
  const index = positions.findIndex((item) => item.id === id);
  if (index === -1) {
    return undefined;
  }
  const updated: StoredPosition = {
    ...positions[index],
    ...patch,
    updatedAt: Date.now(),
  };
  positions[index] = updated;
  await writePositionsToDisk(positions);
  return updated;
}

export async function deletePosition(id: string): Promise<boolean> {
  const positions = await readPositionsFromDisk();
  const next = positions.filter((item) => item.id !== id);
  if (next.length === positions.length) {
    return false;
  }
  await writePositionsToDisk(next);
  return true;
}
