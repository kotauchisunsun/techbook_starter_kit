import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Use the official validator instead of treating a readable ZIP as a valid EPUB.
// EPUBCHECK_JAR also supports Windows and installations without a shell launcher.
export function checkEpub(files = [], { env = process.env, run = spawnSync } = {}) {
  const command = env.EPUBCHECK_JAR ? 'java' : 'epubcheck';
  const prefix = env.EPUBCHECK_JAR ? ['-jar', resolve(env.EPUBCHECK_JAR)] : [];
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
    console.error(error.message);
    process.exitCode = 1;
  }
}
