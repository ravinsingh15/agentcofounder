import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { signalProcessTree, terminateProcessTree, usesDetachedProcessGroup } from "../src/process-tree.js";
import { portHasListener } from "../src/verify-app.js";

const temporaryDirectories: string[] = [];

async function waitForListener(port: number, expected: boolean): Promise<boolean> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    if ((await portHasListener(port)) === expected) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

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

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("process-tree cleanup", () => {
  const processGroupTest = usesDetachedProcessGroup() ? it : it.skip;

  processGroupTest("terminates a background listener after its parent exits normally", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-cofounder-process-tree-"));
    temporaryDirectories.push(directory);
    const listenerPath = path.join(directory, "listener.cjs");
    const launcherPath = path.join(directory, "launcher.cjs");
    const port = await getFreePort();
    await writeFile(
      listenerPath,
      'require("node:net").createServer().listen(Number(process.argv[2]), "127.0.0.1");\n',
      "utf8",
    );
    await writeFile(
      launcherPath,
      'const { spawn } = require("node:child_process"); const child = spawn(process.execPath, [process.argv[2], process.argv[3]], { stdio: "ignore" }); child.unref();\n',
      "utf8",
    );

    const launcher = spawn(process.execPath, [launcherPath, listenerPath, String(port)], {
      detached: true,
      stdio: "ignore",
    });
    await new Promise<void>((resolve, reject) => {
      launcher.once("error", reject);
      launcher.once("close", (code) => (code === 0 ? resolve() : reject(new Error(`Launcher exited ${code}`))));
    });

    try {
      expect(await waitForListener(port, true)).toBe(true);
      await terminateProcessTree(launcher, 100);
      expect(await waitForListener(port, false)).toBe(true);
    } finally {
      signalProcessTree(launcher, "SIGKILL");
    }
  });
});
