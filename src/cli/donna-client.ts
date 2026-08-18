import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";

import type { ProjectConfig } from "../domain/types.js";

export async function runDonnaClient(
  config: ProjectConfig,
  input: Readable = process.stdin,
  output: Writable = process.stdout
): Promise<void> {
  const terminal = createInterface({ input, output, terminal: true });
  output.write(`Donna is connected to ${config.project.name}. Type /exit to leave.\n`);
  try {
    while (true) {
      const message = await terminal.question("Donna> ");
      if (message.trim() === "/exit") break;
      if (!message.trim()) continue;
      const response = await fetch(
        `http://${config.server.host}:${config.server.port}/api/projects/${encodeURIComponent(config.project.id)}/donna`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message, source: "terminal" })
        }
      );
      const body = await response.json() as { message?: string; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? `Donna request failed with ${response.status}`);
      output.write(`${body.message ?? ""}\n`);
    }
  } finally {
    terminal.close();
  }
}
