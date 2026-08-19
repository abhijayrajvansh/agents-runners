import { spawn, type ChildProcess } from "node:child_process";

export type PublicTunnel = {
  url: string;
  close(): Promise<void>;
};

export async function startPublicTunnel(localUrl: string, timeoutMs = 20_000): Promise<PublicTunnel> {
  const child = spawn("cloudflared", [
    "tunnel",
    "--url",
    localUrl,
    "--no-autoupdate",
    "--loglevel",
    "info"
  ], { stdio: ["ignore", "pipe", "pipe"] });

  const url = await waitForTunnelUrl(child, timeoutMs).catch(error => {
    child.kill("SIGTERM");
    throw error;
  });
  let closed = false;
  return {
    url,
    async close() {
      if (closed || child.exitCode !== null) return;
      closed = true;
      child.kill("SIGTERM");
      await new Promise<void>(resolve => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 2_000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  };
}

function waitForTunnelUrl(child: ChildProcess, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("Public tunnel did not become ready within 20 seconds")), timeoutMs);
    const consume = (chunk: Buffer | string) => {
      output = `${output}${chunk.toString()}`.slice(-12_000);
      const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
      if (!match) return;
      clearTimeout(timer);
      resolve(match[0]);
    };
    child.stdout?.on("data", consume);
    child.stderr?.on("data", consume);
    child.once("error", error => {
      clearTimeout(timer);
      reject(new Error(`Could not start cloudflared: ${error.message}`));
    });
    child.once("exit", code => {
      clearTimeout(timer);
      reject(new Error(`cloudflared exited before publishing a URL (${code ?? "unknown"})`));
    });
  });
}
