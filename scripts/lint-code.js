import { readdirSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
export const excludedDirectories = new Set([
  'node_modules', 'output', '.vivliostyle', 'assets', 'epub-generated', 'tmp',
  '.git', '.venv', '.venv-lint', '__pycache__', '.ruff_cache',
]);

// An allowlist, not a repository-wide extension search: prose/assets/workflows
// and temporary build configs are deliberately outside this first phase.
export function sourceFiles(root = repositoryRoot) {
  const files = { javascript: [], python: [], shell: [] };
  const languages = { '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.py': 'python', '.sh': 'shell' };
  function visit(directory, recursive) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory() && recursive && !excludedDirectories.has(entry.name)) visit(path, true);
      if (!entry.isFile()) continue; // Do not follow symlinks into generated/vendor trees.
      const language = languages[extname(entry.name)];
      if (language && (recursive || language === 'javascript')) files[language].push(relative(root, path).split('\\').join('/'));
    }
  }
  visit(root, false);
  visit(join(root, 'scripts'), true);
  for (const paths of Object.values(files)) paths.sort();
  return files;
}

export function lintCode(root = repositoryRoot) {
  const files = sourceFiles(root);
  const commands = [
    [process.execPath, [join(repositoryRoot, 'node_modules/eslint/bin/eslint.js'), '--config', join(repositoryRoot, 'eslint.config.js'), '--max-warnings=0', ...files.javascript]],
    ['ruff', ['check', '--config', join(repositoryRoot, 'ruff.toml'), '--no-cache', ...files.python]],
    ['shellcheck', ['--norc', '--', ...files.shell]],
  ];
  let failed = false;
  for (const [index, [command, args]] of commands.entries()) {
    if (Object.values(files)[index].length === 0) continue;
    const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
    if (result.error) console.error(`${command}: ${result.error.message}. Install requirements-lint.txt and activate its virtual environment (see README).`);
    if (result.error || result.status !== 0) failed = true;
  }
  return failed ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = lintCode();
