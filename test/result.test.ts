import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  composeResult,
  missingRequiredResultPaths,
  normalizePartialResult,
  readPartialResult,
  writeResult,
} from "../src/result.js";
import type {
  AppVerification,
  PartialRunResult,
  PortReclamationAudit,
  UsageSummary,
} from "../src/types.js";
import { validateResultObject } from "../src/validate-result.js";

const partial: PartialRunResult = {
  status: "success",
  app_url: "http://localhost:3000",
  start_command: "npm run dev",
  summary: "A useful app",
  implemented_features: ["Create records"],
  assumptions: ["Used a fixed category set"],
  tests_run: [{ command: "npm test", journey: "Create a record", result: "passed" }],
};

const usage: UsageSummary = {
  model_calls: 1,
  input_tokens: 10,
  output_tokens: 5,
  cache_read_tokens: 2,
  cache_write_tokens: 1,
  total_tokens: 18,
  reasoning_tokens: 0,
  cost_total: 0.01,
  call_log: [
    {
      index: 1,
      model: "test-model",
      input_tokens: 10,
      output_tokens: 5,
      cache_read_tokens: 2,
      cache_write_tokens: 1,
      total_tokens: 18,
      cost_total: 0.01,
    },
  ],
};

const verification: AppVerification = {
  passed: true,
  testsRun: [
    { command: "npm test", journey: "Automated tests", result: "passed" },
    { command: "npm run build", journey: "Production build", result: "passed" },
    { command: "npm run dev", journey: "HTTP startup probe", result: "passed" },
  ],
};

const portReclamation: PortReclamationAudit = {
  preexisting_listener: false,
  listener_after_pi: false,
  attempted: false,
  reclaimed: false,
  process_ids: [],
  diagnostic: "Port 3000 remained free after Pi",
};

describe("result contract", () => {
  it("accepts a reconciled result", async () => {
    const result = composeResult(partial, usage, 0, verification, portReclamation);
    expect(await validateResultObject(result)).toEqual([]);
    expect(result.port_reclamation).toMatchObject({ attempted: false, process_ids: [] });
  });

  it("overrides success when Pi exits unsuccessfully", () => {
    expect(composeResult(partial, usage, 124, verification, portReclamation).status).toBe("failed");
  });

  it("overrides success when telemetry contains no model calls", async () => {
    const zeroUsage: UsageSummary = {
      model_calls: 0,
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      total_tokens: 0,
      reasoning_tokens: 0,
      cost_total: 0,
      call_log: [],
    };
    const result = composeResult(partial, zeroUsage, 0, verification, portReclamation);
    expect(result.status).toBe("failed");
    expect(await validateResultObject({ ...result, status: "success" })).toContain(
      "non-failed result must include at least one model call",
    );
  });

  it("degrades a completed run to partial when an independent app check fails", () => {
    expect(composeResult(partial, usage, 0, { ...verification, passed: false }, portReclamation).status).toBe(
      "partial",
    );
  });

  it("uses runner-owned launch fields and preserves normalized reported product journeys", () => {
    const normalized = normalizePartialResult({
      ...partial,
      app_url: "http://127.0.0.1:3000/",
      start_command: "npm start",
      ignored: "extra",
      tests_run: [{ ...partial.tests_run[0], notes: "chatty model output" }],
    });
    expect(normalized?.tests_run).toEqual(partial.tests_run);
    const result = composeResult(normalized ?? partial, usage, 0, verification, portReclamation);
    expect(result).toMatchObject({
      app_url: "http://localhost:3000",
      start_command: "npm run dev",
      tests_run: verification.testsRun,
      reported_tests: partial.tests_run,
    });
  });

  it("salvages valid report fields instead of collapsing on one malformed field", () => {
    const normalized = normalizePartialResult({
      status: "pass",
      app_url: ["ignored"],
      start_command: ["ignored"],
      summary: "Kept summary",
      implemented_features: ["Feature one", 2, "Feature two"],
      tests_run: [
        { command: "npm test", journey: "Kept journey", result: "passed" },
        { command: ["npm run build"], journey: "Dropped journey", result: "passed" },
      ],
    });

    expect(normalized).toEqual({
      status: "partial",
      app_url: "http://localhost:3000",
      start_command: "npm run dev",
      summary: "Kept summary",
      implemented_features: ["Feature one", "Feature two"],
      assumptions: [],
      tests_run: [{ command: "npm test", journey: "Kept journey", result: "passed" }],
    });
    expect(composeResult(normalized!, usage, 0, verification, portReclamation).status).toBe("partial");
  });

  it("reserves the failed fallback for a missing or unparseable report", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-cofounder-partial-"));
    try {
      await writeFile(path.join(directory, "report.partial.json"), "not json", "utf8");
      expect((await readPartialResult(directory)).status).toBe("failed");
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it("rejects telemetry totals that do not reconcile", async () => {
    const result = composeResult(partial, usage, 0, verification, portReclamation);
    result.input_tokens += 1;
    expect(await validateResultObject(result)).toContain("input_tokens does not reconcile with call_log");
  });

  it("requires every documented harness audit field", async () => {
    const result = composeResult(partial, usage, 0, verification, portReclamation);
    const auditFields = [
      "reported_tests",
      "reasoning_tokens",
      "cost_total",
      "pi_exit_code",
      "telemetry_source",
      "port_reclamation",
    ];

    for (const field of auditFields) {
      const incomplete = structuredClone(result) as unknown as Record<string, unknown>;
      delete incomplete[field];
      expect(await validateResultObject(incomplete)).toEqual([expect.stringContaining(`'${field}'`)]);
    }
  });

  it("keeps the app-root result when an optional mirror cannot be written", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-cofounder-result-"));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const result = composeResult(partial, usage, 0, verification, portReclamation);
      const paths = await writeResult(directory, result, [path.join(directory, "missing", "result.json")]);
      expect(paths).toEqual([path.join(directory, "result.json")]);
      expect(warning).toHaveBeenCalledWith(expect.stringContaining("Unable to write result destination"));
    } finally {
      warning.mockRestore();
      await rm(directory, { recursive: true });
    }
  });

  it("identifies either required result destination when it was not written", () => {
    expect(
      missingRequiredResultPaths(
        ["/challenge/result.json"],
        ["/challenge/output/app/result.json", "/challenge/result.json"],
      ),
    ).toEqual(["/challenge/output/app/result.json"]);
  });
});
