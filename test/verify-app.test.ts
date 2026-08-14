import { cp, mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { portHasListener, verifyGeneratedApp } from "../src/verify-app.js";

const temporaryDirectories: string[] = [];

async function getFreePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Expected a TCP address");
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
}

async function createPassingApp(): Promise<{ appDirectory: string; artifactDirectory: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-cofounder-passing-app-"));
  temporaryDirectories.push(root);
  const appDirectory = path.join(root, "app");
  const seedDirectory = path.resolve("app-template");
  await cp(seedDirectory, appDirectory, {
    recursive: true,
    filter: (source) => !source.split(path.sep).includes("node_modules") && !source.endsWith(`${path.sep}dist`),
  });
  await symlink(path.join(seedDirectory, "node_modules"), path.join(appDirectory, "node_modules"), "dir");
  await writeFile(
    path.join(appDirectory, "src", "generated.test.tsx"),
    [
      'import { useState } from "react";',
      'import { render, screen } from "@testing-library/react";',
      'import userEvent from "@testing-library/user-event";',
      'import { describe, expect, it } from "vitest";',
      "",
      "function Smoke() {",
      "  const [count, setCount] = useState(0);",
      '  return <button type="button" onClick={() => setCount((value) => value + 1)}>Count {count}</button>;',
      "}",
      "",
      'describe("generated journey", () => {',
      '  it("uses the configured DOM and matcher setup", async () => {',
      "    const user = userEvent.setup();",
      "    render(<Smoke />);",
      '    await user.click(screen.getByRole("button", { name: "Count 0" }));',
      '    expect(screen.getByRole("button", { name: "Count 1" })).toHaveTextContent("Count 1");',
      "  });",
      "});",
      "",
    ].join("\n"),
    "utf8",
  );
  const artifactDirectory = path.join(root, "artifacts");
  await mkdir(artifactDirectory);
  return { appDirectory, artifactDirectory };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("app verification", () => {
  it("detects a listener bound to the wildcard address", async () => {
    const server = net.createServer((socket) => socket.end());
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen({ host: "0.0.0.0", port: 0 }, resolve);
    });
    try {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("Expected a TCP address");
      expect(await portHasListener(address.port)).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("returns failed checks instead of throwing when commands and logs cannot be created", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-cofounder-verification-"));
    temporaryDirectories.push(root);
    const appDirectory = path.join(root, "app");
    await mkdir(appDirectory);

    const result = await verifyGeneratedApp(appDirectory, path.join(root, "missing", "artifacts"), {
      commandTimeoutMs: 1_000,
      serverTimeoutMs: 1_000,
      npmCommand: "missing-agent-cofounder-npm",
      vitestCommand: "missing-agent-cofounder-vitest",
      port: await getFreePort(),
    });

    expect(result.passed).toBe(false);
    expect(result.testsRun).toHaveLength(3);
    expect(result.testsRun.every((entry) => entry.result !== "passed")).toBe(true);
  });

  it("rejects the untouched zero-test seed while confirming that it builds and serves", async () => {
    const artifactDirectory = await mkdtemp(path.join(os.tmpdir(), "agent-cofounder-seed-check-"));
    temporaryDirectories.push(artifactDirectory);

    const result = await verifyGeneratedApp(path.resolve("app-template"), artifactDirectory, {
      commandTimeoutMs: 30_000,
      serverTimeoutMs: 10_000,
      port: await getFreePort(),
    });

    expect(result.passed).toBe(false);
    expect(result.testsRun.map((entry) => entry.result)).toEqual(["failed", "passed", "passed"]);
  }, 45_000);

  it("never accepts HTTP from a server that already owned the configured port", async () => {
    let requests = 0;
    const squatter = http.createServer((_request, response) => {
      requests += 1;
      response.end("not the generated app");
    });
    await new Promise<void>((resolve, reject) => {
      squatter.once("error", reject);
      squatter.listen({ host: "0.0.0.0", port: 0 }, resolve);
    });
    const address = squatter.address();
    if (address === null || typeof address === "string") throw new Error("Expected a TCP address");

    const artifactDirectory = await mkdtemp(path.join(os.tmpdir(), "agent-cofounder-port-check-"));
    temporaryDirectories.push(artifactDirectory);
    try {
      const result = await verifyGeneratedApp(path.resolve("app-template"), artifactDirectory, {
        commandTimeoutMs: 30_000,
        serverTimeoutMs: 2_000,
        port: address.port,
      });

      expect(result.testsRun[2]?.result).toBe("failed");
      expect(requests).toBe(0);
    } finally {
      await new Promise<void>((resolve, reject) => {
        squatter.close((error) => (error ? reject(error) : resolve()));
      });
    }
  }, 45_000);

  it("passes a generated app with participant-authored tests, a build, and its own server", async () => {
    const { appDirectory, artifactDirectory } = await createPassingApp();
    const port = await getFreePort();

    const result = await verifyGeneratedApp(appDirectory, artifactDirectory, {
      commandTimeoutMs: 30_000,
      serverTimeoutMs: 10_000,
      port,
    });

    expect(result.passed).toBe(true);
    expect(result.testsRun.map((entry) => entry.result)).toEqual(["passed", "passed", "passed"]);
    expect(result.testsRun[0]?.command).toContain("--outputFile=");
    const displayedReportPath = result.testsRun[0]?.command.split("--outputFile=")[1]?.split(" ")[0];
    expect(displayedReportPath).toBeDefined();
    expect(path.isAbsolute(displayedReportPath!)).toBe(false);
  }, 45_000);

  it("keeps verification verdicts independent from audit-log writes", async () => {
    const { appDirectory, artifactDirectory } = await createPassingApp();
    await Promise.all([
      writeFile(path.join(artifactDirectory, "app-test.log"), "existing\n", "utf8"),
      writeFile(path.join(artifactDirectory, "app-build.log"), "existing\n", "utf8"),
      writeFile(path.join(artifactDirectory, "app-dev.log"), "existing\n", "utf8"),
    ]);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const result = await verifyGeneratedApp(appDirectory, artifactDirectory, {
        commandTimeoutMs: 30_000,
        serverTimeoutMs: 10_000,
        port: await getFreePort(),
      });

      expect(result.passed).toBe(true);
      expect(result.testsRun.map((entry) => entry.result)).toEqual(["passed", "passed", "passed"]);
      expect(warning).toHaveBeenCalledTimes(3);
    } finally {
      warning.mockRestore();
    }
  }, 45_000);
});
