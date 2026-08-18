import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

export class ProjectDiscoveryError extends Error {
  readonly code: "NOT_GIT_REPOSITORY" | "INTEGRATION_BRANCH_NOT_FOUND";

  constructor(code: ProjectDiscoveryError["code"], message: string) {
    super(message);
    this.name = "ProjectDiscoveryError";
    this.code = code;
  }
}

async function git(root: string, args: string[]): Promise<string> {
  try {
    const result = await exec("git", args, { cwd: root });
    return result.stdout.trim();
  } catch (error) {
    throw error;
  }
}

export async function discoverRepository(inputPath: string, integrationBranch = "dev") {
  const requestedRoot = path.resolve(inputPath);
  let repositoryRoot: string;
  try {
    repositoryRoot = path.resolve(await git(requestedRoot, ["rev-parse", "--show-toplevel"]));
  } catch {
    throw new ProjectDiscoveryError("NOT_GIT_REPOSITORY", `${requestedRoot} is not inside a Git repository`);
  }

  try {
    await git(repositoryRoot, ["rev-parse", "--verify", `refs/heads/${integrationBranch}`]);
  } catch {
    throw new ProjectDiscoveryError(
      "INTEGRATION_BRANCH_NOT_FOUND",
      `Integration branch ${integrationBranch} does not exist in ${repositoryRoot}`
    );
  }

  const currentBranch = await git(repositoryRoot, ["branch", "--show-current"]);
  const name = path.basename(repositoryRoot);
  return { repositoryRoot, currentBranch, integrationBranch, name };
}
