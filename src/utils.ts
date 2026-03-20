import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, resolve } from "node:path";
import { promisify } from "node:util";
import { RepoRef } from "./types.js";

const execFileAsync = promisify(execFile);

export async function runCommand(
  command: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await execFileAsync(command, args, {
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
    });
    return {
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
      exitCode: 0,
    };
  } catch (error) {
    const typed = error as NodeJS.ErrnoException & {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      code?: number | string;
    };
    return {
      stdout: typed.stdout?.toString() ?? "",
      stderr: typed.stderr?.toString() ?? typed.message,
      exitCode: typeof typed.code === "number" ? typed.code : 1,
    };
  }
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await readFile(resolve(filePath), "utf8");
  return JSON.parse(raw) as T;
}

export async function readTextFile(filePath: string): Promise<string> {
  return readFile(resolve(filePath), "utf8");
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(resolve(filePath));
    return true;
  } catch {
    return false;
  }
}

export function resolveFromBaseDir(baseDir: string, targetPath: string): string {
  if (isAbsolute(targetPath)) {
    return targetPath;
  }
  return resolve(baseDir, targetPath);
}

export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(resolve(dirPath), { recursive: true });
}

export async function writeTextFile(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(resolve(filePath)), { recursive: true });
  await writeFile(resolve(filePath), content, "utf8");
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function daysBetween(fromIso: string, now = new Date()): number {
  const from = new Date(fromIso);
  const diffMs = now.getTime() - from.getTime();
  return Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)));
}

export function parseRepository(input: string): RepoRef {
  const normalized = input.trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\/+$/, "");
  const parts = normalized.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid repository reference: "${input}"`);
  }
  return {
    owner: parts[0],
    repo: parts[1],
    fullName: `${parts[0]}/${parts[1]}`,
  };
}

export function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

export function normalizeLabel(label: string): string {
  return label.trim().toLowerCase();
}

export function extensionForPath(path: string): string | undefined {
  const ext = extname(path).toLowerCase();
  return ext ? ext.slice(1) : undefined;
}

export function directoryForPath(path: string): string | undefined {
  const normalized = path.replace(/\\/g, "/");
  const [first] = normalized.split("/");
  return first || undefined;
}

export function csvEscape(value: string | number | boolean | undefined): string {
  const stringValue = value === undefined ? "" : String(value);
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, "\"\"")}"`;
  }
  return stringValue;
}

export async function mapLimit<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) {
        return;
      }
      results[current] = await mapper(items[current] as T, current);
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
