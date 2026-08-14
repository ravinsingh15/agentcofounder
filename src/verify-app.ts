import { spawn, type ChildProcess } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { signalProcessTree, usesDetachedProcessGroup } from "./process-tree.js";
import type { AppVerification, TestRun } from "./types.js";

const MAX_LOG_BYTES = 5 * 1024 * 1024;

interface CommandOutcome {
  exitCode: number;
  timedOut: boolean;
  logWritten: boolean;
}

interface VitestReport {
  numTotalTests?: unknown;
  numFailedTests?: unknown;
  success?: unknown;
}

export interface VerificationOptions {
  commandTimeoutMs?: number;
  serverTimeoutMs?: number;
  npmCommand?: string;
  vitestCommand?: string;
}

interface CapturedOutput {
  chunks: Buffer[];
  length: number;
  truncated: boolean;
}

function commandName(name: string): string {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function captureOutput(captured: CapturedOutput, chunk: Buffer): void {
  const remaining = MAX_LOG_BYTES - captured.length;
  if (remaining <= 0) {
    captured.truncated = true;
    return;
  }

  const kept = chunk.length <= remaining ? chunk : chunk.subarray(0, remaining);
  captured.chunks.push(kept);
  captured.length += kept.length;
  if (kept.length !== chunk.length) captured.truncated = true;
}

function renderOutput(captured: CapturedOutput): string {
  const content = Buffer.concat(captured.chunks).toString("utf8");
  return captured.truncated ? `${content}\n[log truncated at ${MAX_LOG_BYTES} bytes]\n` : content;
}

async function safeWriteLog(logPath: string, content: string): Promise<boolean> {
  try {
    await writeFile(logPath, content, { encoding: "utf8", flag: "wx" });
    return true;
  } catch {
    return false;
  }
}

function safeSignalProcessTree(child: ChildProcess, signal: NodeJS.Signals): void {
  try {
    signalProcessTree(child, signal);
  } catch {
    // Verification must degrade to a failed check instead of aborting result assembly.
  }
}

async function runLoggedCommand(
  command: string,
  args: string[],
  cwd: string,
  logPath: string,
  timeoutMs: number,
): Promise<CommandOutcome> {
  const captured: CapturedOutput = { chunks: [], length: 0, truncated: false };

  const outcome = await new Promise<Omit<CommandOutcome, "logWritten">>((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(command, args, {
        cwd,
        detached: usesDetachedProcessGroup(),
        env: process.env,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      captureOutput(captured, Buffer.from(`${String(error)}\n`));
      resolve({ exitCode: 1, timedOut: false });
      return;
    }

    let settled = false;
    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;
    let hardStopTimer: NodeJS.Timeout | undefined;
    const finish = (exitCode: number): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      if (hardStopTimer) clearTimeout(hardStopTimer);
      resolve({ exitCode, timedOut });
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      safeSignalProcessTree(child, "SIGTERM");
      killTimer = setTimeout(() => {
        safeSignalProcessTree(child, "SIGKILL");
        hardStopTimer = setTimeout(() => finish(124), 1_000);
      }, 5_000);
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      captureOutput(captured, chunk);
      process.stdout.write(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      captureOutput(captured, chunk);
      process.stderr.write(chunk);
    });
    child.once("error", (error) => {
      captureOutput(captured, Buffer.from(`${String(error)}\n`));
      finish(1);
    });
    child.once("close", (code) => finish(timedOut ? 124 : (code ?? 1)));
  });

  return {
    ...outcome,
    logWritten: await safeWriteLog(logPath, renderOutput(captured)),
  };
}

export async function portHasListener(port: number, timeoutMs = 500): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    let settled = false;
    const finish = (listening: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(listening);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(timeoutMs, () => finish(false));
  });
}

async function waitForHttp(
  url: string,
  timeoutMs: number,
  childIsRunning: () => boolean,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && childIsRunning()) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      await response.text();
      if (response.ok) {
        await delay(300);
        return childIsRunning();
      }
    } catch {
      // The development server may still be starting.
    }
    await delay(200);
  }
  return false;
}

async function waitForPortToClose(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await portHasListener(port))) return true;
    await delay(100);
  }
  return false;
}

async function verifyDevelopmentServer(
  appDirectory: string,
  logPath: string,
  timeoutMs: number,
  npmCommand: string,
): Promise<boolean> {
  const port = 3000;
  if (await portHasListener(port)) {
    await safeWriteLog(logPath, "Port 3000 already had a listener before app verification.\n");
    return false;
  }

  const captured: CapturedOutput = { chunks: [], length: 0, truncated: false };
  let child: ChildProcess;
  try {
    child = spawn(npmCommand, ["run", "dev"], {
      cwd: appDirectory,
      detached: usesDetachedProcessGroup(),
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    await safeWriteLog(logPath, `${String(error)}\n`);
    return false;
  }

  child.stdout?.on("data", (chunk: Buffer) => {
    captureOutput(captured, chunk);
    process.stdout.write(chunk);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    captureOutput(captured, chunk);
    process.stderr.write(chunk);
  });

  let childClosed = false;
  const closed = new Promise<number>((resolve) => {
    child.once("close", (code) => {
      childClosed = true;
      resolve(code ?? 1);
    });
  });
  const failed = new Promise<{ kind: "error" }>((resolve) => {
    child.once("error", (error) => {
      captureOutput(captured, Buffer.from(`${String(error)}\n`));
      resolve({ kind: "error" });
    });
  });
  const childIsRunning = (): boolean => !childClosed && child.exitCode === null;

  let served = false;
  try {
    const startup = await Promise.race([
      waitForHttp("http://127.0.0.1:3000", timeoutMs, childIsRunning).then((ready) => ({
        kind: "probe" as const,
        ready,
      })),
      closed.then((exitCode) => ({ kind: "exit" as const, exitCode })),
      failed,
    ]);
    served = startup.kind === "probe" && startup.ready && childIsRunning();
  } catch (error) {
    captureOutput(captured, Buffer.from(`${String(error)}\n`));
  } finally {
    safeSignalProcessTree(child, "SIGTERM");
    const exitedAfterTerm = await Promise.race([
      closed.then(() => true),
      delay(5_000).then(() => false),
    ]);
    if (!exitedAfterTerm) {
      safeSignalProcessTree(child, "SIGKILL");
      await Promise.race([closed, delay(2_000)]);
    }
  }

  const portClosed = await waitForPortToClose(port, 2_000);
  const logWritten = await safeWriteLog(logPath, renderOutput(captured));
  return served && childClosed && portClosed && logWritten;
}

function testRun(command: string, journey: string, result: TestRun["result"]): TestRun {
  return { command, journey, result };
}

function verificationCommands(
  appDirectory: string,
  artifactDirectory: string,
  npmCommand: string,
  vitestCommand: string,
): { test: { args: string[]; display: string }; build: string; dev: string } {
  const reportPath = path.join(artifactDirectory, "app-test-results.json");
  const testArgs = [
    "run",
    "--reporter=json",
    `--outputFile=${reportPath}`,
    "--passWithNoTests=false",
  ];
  const displayedVitest = path.relative(appDirectory, vitestCommand) || vitestCommand;
  return {
    test: { args: testArgs, display: [displayedVitest, ...testArgs].join(" ") },
    build: `${npmCommand} run build`,
    dev: `${npmCommand} run dev`,
  };
}

async function hasPassingVitestReport(reportPath: string): Promise<boolean> {
  try {
    const report = JSON.parse(await readFile(reportPath, "utf8")) as VitestReport;
    return (
      report.success === true &&
      typeof report.numTotalTests === "number" &&
      report.numTotalTests > 0 &&
      report.numFailedTests === 0
    );
  } catch {
    return false;
  }
}

export function skippedAppVerification(reason: string): AppVerification {
  return {
    passed: false,
    testsRun: [
      testRun("vitest run", `App tests were not run: ${reason}`, "skipped"),
      testRun("npm run build", `Production build was not run: ${reason}`, "skipped"),
      testRun("npm run dev", `HTTP startup probe was not run: ${reason}`, "skipped"),
    ],
  };
}

export async function verifyGeneratedApp(
  appDirectory: string,
  artifactDirectory: string,
  options: VerificationOptions = {},
): Promise<AppVerification> {
  const commandTimeoutMs = options.commandTimeoutMs ?? 120_000;
  const serverTimeoutMs = options.serverTimeoutMs ?? 20_000;
  const npmCommand = options.npmCommand ?? commandName("npm");
  const vitestCommand =
    options.vitestCommand ??
    path.join(appDirectory, "node_modules", ".bin", process.platform === "win32" ? "vitest.cmd" : "vitest");
  const commands = verificationCommands(appDirectory, artifactDirectory, npmCommand, vitestCommand);
  const testReportPath = path.join(artifactDirectory, "app-test-results.json");

  try {
    const test = await runLoggedCommand(
      vitestCommand,
      commands.test.args,
      appDirectory,
      path.join(artifactDirectory, "app-test.log"),
      commandTimeoutMs,
    );
    const testsPassed =
      test.exitCode === 0 && test.logWritten && (await hasPassingVitestReport(testReportPath));
    const build = await runLoggedCommand(
      npmCommand,
      ["run", "build"],
      appDirectory,
      path.join(artifactDirectory, "app-build.log"),
      commandTimeoutMs,
    );
    const serverPassed = await verifyDevelopmentServer(
      appDirectory,
      path.join(artifactDirectory, "app-dev.log"),
      serverTimeoutMs,
      npmCommand,
    );

    const testsRun = [
      testRun(
        commands.test.display,
        "The generated app's Vitest report contained at least one test and no failures",
        testsPassed ? "passed" : "failed",
      ),
      testRun(
        commands.build,
        "The generated app completed a production build",
        build.exitCode === 0 && build.logWritten ? "passed" : "failed",
      ),
      testRun(
        commands.dev,
        "The generated app started its own HTTP server on port 3000 and shut down cleanly",
        serverPassed ? "passed" : "failed",
      ),
    ];

    return { passed: testsRun.every((entry) => entry.result === "passed"), testsRun };
  } catch (error) {
    await safeWriteLog(path.join(artifactDirectory, "app-verification-error.log"), `${String(error)}\n`);
    return {
      passed: false,
      testsRun: [
        testRun(commands.test.display, "App verification encountered an internal error", "failed"),
        testRun(commands.build, "Production build could not be verified", "skipped"),
        testRun(commands.dev, "HTTP startup could not be verified", "skipped"),
      ],
    };
  }
}
