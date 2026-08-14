import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildPiArguments, runPi } from "../src/run-challenge.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("Pi launch", () => {
  it("uses deterministic non-interactive flags and defaults thinking off", () => {
    const previousThinking = process.env.CHALLENGE_THINKING;
    delete process.env.CHALLENGE_THINKING;
    try {
      const args = buildPiArguments("Build a tool", "Stable system prompt", "Stable app contract", "/tmp/run");
      expect(args).toContain("--offline");
      expect(args).toContain("--no-context-files");
      expect(args).not.toContain("--print");
      expect(args).not.toContain("--approve");
      expect(args[args.indexOf("--thinking") + 1]).toBe("off");
      expect(args[args.indexOf("--system-prompt") + 1]).toContain("Stable app contract");
      expect(args.at(-1)).toContain("Build a tool");
    } finally {
      if (previousThinking === undefined) delete process.env.CHALLENGE_THINKING;
      else process.env.CHALLENGE_THINKING = previousThinking;
    }
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
