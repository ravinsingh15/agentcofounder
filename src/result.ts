import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppVerification, PartialRunResult, RunResult, TestRun, UsageSummary } from "./types.js";

const FALLBACK_PARTIAL: PartialRunResult = {
  status: "failed",
  app_url: "http://localhost:3000",
  start_command: "npm run dev",
  summary: "The harness did not produce a valid report.partial.json file.",
  implemented_features: [],
  assumptions: [],
  tests_run: [],
};

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function normalizePartialResult(value: unknown): PartialRunResult | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const result = value as Record<string, unknown>;
  const validTests =
    Array.isArray(result.tests_run) &&
    result.tests_run.every((test) => {
      if (typeof test !== "object" || test === null) return false;
      const candidate = test as Record<string, unknown>;
      return (
        typeof candidate.command === "string" &&
        typeof candidate.journey === "string" &&
        ["passed", "failed", "skipped"].includes(String(candidate.result))
      );
    });

  if (!(
    ["success", "partial", "failed"].includes(String(result.status)) &&
    typeof result.app_url === "string" &&
    typeof result.start_command === "string" &&
    typeof result.summary === "string" &&
    strings(result.implemented_features) &&
    strings(result.assumptions) &&
    validTests
  )) return undefined;

  return {
    status: result.status as PartialRunResult["status"],
    app_url: result.app_url as string,
    start_command: result.start_command as string,
    summary: result.summary as string,
    implemented_features: [...(result.implemented_features as string[])],
    assumptions: [...(result.assumptions as string[])],
    tests_run: (result.tests_run as Array<Record<string, unknown>>).map<TestRun>((test) => ({
      command: test.command as string,
      journey: test.journey as string,
      result: test.result as TestRun["result"],
    })),
  };
}

export async function readPartialResult(appDirectory: string): Promise<PartialRunResult> {
  try {
    const raw = await readFile(path.join(appDirectory, "report.partial.json"), "utf8");
    const parsed: unknown = JSON.parse(raw);
    return normalizePartialResult(parsed) ?? FALLBACK_PARTIAL;
  } catch {
    return FALLBACK_PARTIAL;
  }
}

export function composeResult(
  partial: PartialRunResult,
  usage: UsageSummary,
  piExitCode: number,
  verification: AppVerification,
): RunResult {
  const runFailed = piExitCode !== 0 || usage.model_calls === 0 || partial.status === "failed";
  const status = runFailed ? "failed" : verification.passed ? partial.status : "partial";
  return {
    ...partial,
    status,
    app_url: "http://localhost:3000",
    start_command: "npm run dev",
    reported_tests: partial.tests_run,
    tests_run: verification.testsRun,
    ...usage,
    pi_exit_code: piExitCode,
    telemetry_source: "pi-json-event-stream",
  };
}

export async function writeResult(
  appDirectory: string,
  result: RunResult,
  mirrorPaths: string[] = [],
): Promise<string[]> {
  const resultPath = path.join(appDirectory, "result.json");
  const content = `${JSON.stringify(result, null, 2)}\n`;
  const writtenPaths: string[] = [];
  for (const destination of [resultPath, ...mirrorPaths]) {
    try {
      await writeFile(destination, content, "utf8");
      writtenPaths.push(destination);
    } catch {
      // Preserve every result destination that remains writable.
    }
  }
  if (writtenPaths.length === 0) throw new Error("Unable to write result.json to any configured destination");
  return writtenPaths;
}
