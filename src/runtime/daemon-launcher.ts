import type { ProjectConfig } from "../domain/types.js";

type RequestOptions = {
  method: "GET" | "POST";
  body?: Record<string, unknown>;
};

export type DaemonLauncherDependencies = {
  request(url: string, options: RequestOptions): Promise<{ ok: boolean }>;
  spawnDaemon(): Promise<void>;
  sleep(milliseconds: number): Promise<void>;
};

export async function ensureDaemonForProject(
  config: ProjectConfig,
  dependencies: DaemonLauncherDependencies
): Promise<{ url: string; started: boolean }> {
  const baseUrl = `http://${config.server.host}:${config.server.port}`;
  const healthUrl = `${baseUrl}/health`;
  let healthy = await isHealthy(healthUrl, dependencies);
  let started = false;

  if (!healthy) {
    started = true;
    await dependencies.spawnDaemon();
    for (let attempt = 0; attempt < 40 && !healthy; attempt += 1) {
      await dependencies.sleep(100);
      healthy = await isHealthy(healthUrl, dependencies);
    }
  }

  if (!healthy) throw new Error(`Agents Runners daemon did not become ready at ${healthUrl}`);
  const registered = await dependencies.request(`${baseUrl}/api/projects/register`, {
    method: "POST",
    body: { root: config.project.repositoryRoot }
  });
  if (!registered.ok) throw new Error(`Agents Runners could not register ${config.project.repositoryRoot}`);

  return { url: `${baseUrl}/projects/${config.project.id}`, started };
}

async function isHealthy(url: string, dependencies: DaemonLauncherDependencies): Promise<boolean> {
  try {
    return (await dependencies.request(url, { method: "GET" })).ok;
  } catch {
    return false;
  }
}
