import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PublicAsterClient } from "@aster/client";
import { describe, expect, it } from "vitest";
import { runResearch } from "./research.js";

describe("research surface", () => {
  it("exposes the research loop and no Aster write method", () => {
    expect(typeof runResearch).toBe("function");
    const client = new PublicAsterClient("https://fapi.asterdex.com", async () => {
      throw new Error("unused");
    });
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(client));
    expect(methods.some((name) => /order|withdraw|transfer|leverage/i.test(name))).toBe(false);

    const directory = path.dirname(fileURLToPath(import.meta.url));
    const sources = readdirSync(directory).filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"));
    for (const file of sources) {
      const source = readFileSync(path.join(directory, file), "utf8");
      expect(source).not.toMatch(/\/fapi\/v3\/order/);
      expect(source).not.toMatch(/placeOrder|user-withdraw|batch-transfer/);
    }
  });
});
