import request from "supertest";
import { describe, expect, it } from "vitest";

import { app } from "../src/server.js";

describe("/api/hints", () => {
  it("returns contextual hints for a parsed signal", async () => {
    const response = await request(app)
      .post("/api/hints")
      .send({ text: "Long BTC size 2 entry 62000 stop 60000" })
      .expect(200);

    expect(response.body).toHaveProperty("context.symbol", "BTC");
    expect(response.body.context).toHaveProperty("atrPercent");
    const trailingHint = response.body.hints.find((hint) => hint.slot === "trailingStop");
    expect(trailingHint).toBeDefined();
    expect(trailingHint.action?.feature).toBe("trailingStop");
    expect(trailingHint.action?.params?.value).toBeGreaterThan(0);
  });

  it("surfaces a parse warning for malformed input", async () => {
    const response = await request(app)
      .post("/api/hints")
      .send({ text: "??? invalid ???" })
      .expect(200);

    const parseHint = response.body.hints.find((hint) => hint.id === "unparsed-signal");
    expect(parseHint).toBeDefined();
    expect(parseHint.severity).toBe("warning");
  });

  it("flags oversized positions relative to liquidity", async () => {
    const response = await request(app)
      .post("/api/hints")
      .send({ text: "Long SOL size 900000 entry 150 stop 120 tp1 180" })
      .expect(200);

    const sizeHint = response.body.hints.find((hint) => hint.slot === "signal");
    expect(sizeHint).toBeDefined();
    expect(["warning", "danger"]).toContain(sizeHint.severity);
    expect(sizeHint.message).toContain("liquidity");
    expect(response.body.context).toHaveProperty("notionalUsd");
  });
});
