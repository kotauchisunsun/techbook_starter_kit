import { spawnSync, type SpawnSyncOptions } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface CheckResult {
  status?: number | null;
  signal?: NodeJS.Signals | null;
  error?: Error & { code?: string };
}
export interface CheckOptions {
  env?: NodeJS.ProcessEnv;
  run?: (command: string, args: string[], options: SpawnSyncOptions) => CheckResult;
  exists?: (path: string) => boolean;
}

// Use the official validator instead of treating a readable ZIP as a valid EPUB.
// EPUBCHECK_JAR also supports Windows and installations without a shell launcher.
export function checkEpub(files: string[] = [], { env = process.env, run = spawnSync, exists = existsSync }: CheckOptions = {}) {
  // Debian/Ubuntu's executable is a JAR symlink and depends on binfmt_misc,
  // which is unavailable in ordinary Docker containers. Invoke Java directly.
  const systemJar = '/usr/share/java/epubcheck.jar';
  const jar = env.EPUBCHECK_JAR || (exists(systemJar) ? systemJar : undefined);
  const command = jar ? 'java' : 'epubcheck';
  const prefix = jar ? ['-jar', resolve(jar)] : [];
  for (const file of files.length ? files : ['output/epub/book.epub']) {
    // Absolute paths keep filenames beginning with '-' from becoming options.
    const result = run(command, [...prefix, resolve(file)], { stdio: 'inherit', env, shell: false });
    if (result.error) {
      if (result.error.code === 'ENOENT') {
        throw new Error(`${command} が見つかりません。EPUBCheck をインストールするか、Java を用意して EPUBCHECK_JAR に epubcheck.jar のパスを設定してください。`, { cause: result.error });
      }
      throw result.error;
    }
    if (result.signal) throw new Error(`EPUBCheck が ${result.signal} で終了しました: ${file}`);
    if (result.status !== 0) return result.status ?? 1;
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.exitCode = checkEpub(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
