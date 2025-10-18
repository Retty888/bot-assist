import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import requestFactory from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("API service contracts", () => {
  const tempPrefix = path.join(os.tmpdir(), "bot-assist-api-");
  let tempDir: string;

  let request: ReturnType<typeof requestFactory>;

  beforeAll(async () => {
    tempDir = await mkdtemp(tempPrefix);
    process.env.BOT_DATA_DIR = tempDir;

    const { app } = await import("../../src/server.js");
    request = requestFactory(app);
  });

  afterAll(async () => {
    delete process.env.BOT_DATA_DIR;
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("returns the default signal template", async () => {
    const response = await request.get("/api/default-signal");

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("defaultSignal");
    expect(response.body.defaultSignal).toContain("Long BTC");
  });

  it("rejects hint requests without signal text", async () => {
    const response = await request.post("/api/hints").send({});

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: "Signal text is required" });
  });

  it("generates contextual hints for a BTC signal", async () => {
    const response = await request
      .post("/api/hints")
      .send({ text: "Long BTC size 1 entry 60100 stop 58650" })
      .set("Content-Type", "application/json");

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.hints)).toBe(true);
    expect(response.body.hints.length).toBeGreaterThan(0);
    expect(response.body.context).toMatchObject({ symbol: "BTC" });
  });

  it("manages positions through the lifecycle", async () => {
    const listResponse = await request.get("/api/positions");
    expect(listResponse.status).toBe(200);
    expect(Array.isArray(listResponse.body.items)).toBe(true);
    const seededIds = listResponse.body.items.map((item: { id: string }) => item.id);

    const createResponse = await request
      .post("/api/positions")
      .send({
        symbol: "OP",
        side: "long",
        size: 5,
        entryPrice: 2.15,
        stopLoss: 1.95,
        takeProfit: 2.6,
        tags: ["integration"],
        notes: "QA scenario",
        source: "test",
      })
      .set("Content-Type", "application/json");

    expect(createResponse.status).toBe(201);
    expect(createResponse.body).toMatchObject({ symbol: "OP", side: "long" });
    expect(createResponse.body).toHaveProperty("id");

    const positionId = createResponse.body.id as string;

    const updateResponse = await request
      .put(`/api/positions/${positionId}`)
      .send({ notes: "Adjusted target", takeProfit: 2.7 })
      .set("Content-Type", "application/json");

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body).toMatchObject({ id: positionId, takeProfit: 2.7 });

    const deleteResponse = await request.delete(`/api/positions/${positionId}`);
    expect(deleteResponse.status).toBe(204);

    const missingResponse = await request.delete(`/api/positions/${positionId}`);
    expect(missingResponse.status).toBe(404);

    // Ensure seeded positions remain untouched
    const finalList = await request.get("/api/positions");
    expect(finalList.status).toBe(200);
    const finalIds = new Set(finalList.body.items.map((item: { id: string }) => item.id));
    seededIds.forEach((id: string) => {
      expect(finalIds.has(id)).toBe(true);
    });
  });

  it("executes a signal end-to-end in demo mode and records history", async () => {
    const executionResponse = await request
      .post("/api/execute")
      .send({ text: "Long BTC size 2 entry 60420 stop 58650 tp1 63100" })
      .set("Content-Type", "application/json");

    expect(executionResponse.status).toBe(200);
    expect(executionResponse.body).toMatchObject({ demoMode: true });
    expect(executionResponse.body.signal).toMatchObject({ symbol: "BTC" });
    expect(Array.isArray(executionResponse.body.payload?.orders)).toBe(true);

    const signalHistoryResponse = await request.get("/api/history/signals");
    expect(signalHistoryResponse.status).toBe(200);
    expect(signalHistoryResponse.body.items.length).toBeGreaterThan(0);

    const tradeHistoryResponse = await request.get("/api/history/trades");
    expect(tradeHistoryResponse.status).toBe(200);
    expect(tradeHistoryResponse.body.items.length).toBeGreaterThan(0);
  });
});

