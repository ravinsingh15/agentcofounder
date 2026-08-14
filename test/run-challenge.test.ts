import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildPiArguments, runPi, runRequiresFailureExit } from "../src/run-challenge.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("Pi launch", () => {
  it("fails an otherwise successful run when a required result destination is missing", () => {
    expect(runRequiresFailureExit(0, "success", ["/challenge/result.json"])).toBe(true);
    expect(runRequiresFailureExit(0, "success", [])).toBe(false);
  });

  it("uses deterministic non-interactive flags and defaults thinking off", () => {
    const previousThinking = process.env.CHALLENGE_THINKING;
    delete process.env.CHALLENGE_THINKING;
    try {
      const args = buildPiArguments(
        "Build a tool",
        "Stable system prompt",
        "Create, edit, delete, narrow, derive, and persist",
        "Stable app contract",
        "/tmp/run",
      );
      expect(args).toContain("--offline");
      expect(args).toContain("--no-context-files");
      expect(args).not.toContain("--print");
      expect(args).not.toContain("--approve");
      expect(args[args.indexOf("--thinking") + 1]).toBe("off");
      expect(args[args.indexOf("--system-prompt") + 1]).toContain("Stable app contract");
      expect(args[args.indexOf("--system-prompt") + 1]).toContain("Create, edit, delete, narrow, derive, and persist");
      expect(args.at(-1)).toContain("Build a tool");
    } finally {
      if (previousThinking === undefined) delete process.env.CHALLENGE_THINKING;
      else process.env.CHALLENGE_THINKING = previousThinking;
    }
  });

  it("injects structurally consistent public journey guidance into Pi's system prompt", async () => {
    const [systemPrompt, publicJourneys, appContext] = await Promise.all([
      readFile(path.resolve("solution/system-prompt.md"), "utf8"),
      readFile(path.resolve("contract-public/journeys.md"), "utf8"),
      readFile(path.resolve("app-template/AGENTS.md"), "utf8"),
    ]);
    const args = buildPiArguments("Build a tool", systemPrompt, publicJourneys, appContext, "/tmp/run");
    const suppliedSystemPrompt = args[args.indexOf("--system-prompt") + 1] ?? "";
    const behaviorSection = /## Behaviors to implement and test when implied\s+([\s\S]*?)\n## /u.exec(
      publicJourneys,
    )?.[1];
    const requirementSection = /## Run and reporting requirements\s+([\s\S]*)$/u.exec(publicJourneys)?.[1];
    const behaviorItems = [...(behaviorSection ?? "").matchAll(/^\d+\.\s+(.+)$/gmu)].map((match) => match[1]);
    const requirementItems = [...(requirementSection ?? "").matchAll(/^-\s+(.+)$/gmu)].map(
      (match) => match[1],
    );

    expect(suppliedSystemPrompt).toContain(publicJourneys.trim());
    expect(behaviorItems.length).toBeGreaterThan(0);
    expect(requirementItems.length).toBeGreaterThan(0);
    for (const contractItem of [...behaviorItems, ...requirementItems]) {
      expect(suppliedSystemPrompt).toContain(contractItem);
    }
    expect(suppliedSystemPrompt).toContain("omit it instead of inventing an equivalent feature");
    expect(suppliedSystemPrompt).toContain("Never omit an implied journey merely to simplify");
    expect(suppliedSystemPrompt.match(/^# Generated application contract$/gmu)).toHaveLength(1);
    expect(suppliedSystemPrompt).not.toMatch(/^## Generated application contract$/mu);
  });

  it("reaches Pi provider validation without waiting for stdin EOF", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-cofounder-pi-launch-"));
    temporaryDirectories.push(directory);
    await mkdir(path.join(directory, "sessions"));
    const eventFile = path.join(directory, "events.jsonl");
    const stderrFile = path.join(directory, "stderr.log");

    const result = await runPi(
      [
        "--mode",
        "json",
        "--offline",
        "--no-extensions",
        "--no-skills",
        "--no-prompt-templates",
        "--no-themes",
        "--no-context-files",
        "--no-session",
        "--provider",
        "bogus-provider",
        "--model",
        "bogus-model",
        "Launch smoke test",
      ],
      directory,
      eventFile,
      stderrFile,
      5_000,
    );

    expect(result.timedOut).toBe(false);
    expect(result.exitCode).not.toBe(124);
    expect(await readFile(stderrFile, "utf8")).toContain("Unknown provider");
  }, 10_000);
});
