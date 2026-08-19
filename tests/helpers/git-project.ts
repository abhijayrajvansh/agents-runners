import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

export async function createGitProjectWithRemote() {
  const container = await mkdtemp(path.join(tmpdir(), "agents-runners-git-"));
  const remote = path.join(container, "origin.git");
  const root = path.join(container, "project");
  await mkdir(root);
  await exec("git", ["init", "--bare", remote]);
  await exec("git", ["init", "-b", "dev"], { cwd: root });
  await exec("git", ["config", "user.email", "agents-runners@example.test"], { cwd: root });
  await exec("git", ["config", "user.name", "Agents Runners Test"], { cwd: root });
  await writeFile(path.join(root, ".gitignore"), ".worktrees/\n.env*\n", "utf8");
  await writeFile(path.join(root, "README.md"), "# Demo\n", "utf8");
  await exec("git", ["add", ".gitignore", "README.md"], { cwd: root });
  await exec("git", ["commit", "-m", "initial"], { cwd: root });
  await exec("git", ["remote", "add", "origin", remote], { cwd: root });
  await exec("git", ["push", "-u", "origin", "dev"], { cwd: root });
  return {
    root,
    remote,
    git: (args: string[], cwd = root) => exec("git", args, { cwd }).then(result => result.stdout.trim()),
    cleanup: () => rm(container, { recursive: true, force: true })
  };
}
