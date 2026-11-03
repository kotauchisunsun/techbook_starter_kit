import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ESLint } from 'eslint';
import yaml from 'js-yaml';
import { repositoryRoot, excludedDirectories } from './lint-code.js';

const extensions = new Set(['.js', '.mjs', '.cjs', '.json', '.yaml', '.yml', '.css', '.sh', '.py']);
const excluded = new Set([...excludedDirectories, 'fixtures', 'release']);

// Scope is the publishing system, not the author's content or arbitrary folders.
export function systemFiles(root = repositoryRoot) {
  const files = { eslint: [], shell: [], python: [], workflows: [] };
  function visit(directory, recursive) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory() && recursive && !excluded.has(entry.name) && !entry.name.startsWith('.venv')) visit(path, true);
      if (!entry.isFile() || entry.name === 'package-lock.json' || !extensions.has(extname(entry.name))) continue;
      const name = relative(root, path).split('\\').join('/');
      const language = { '.sh': 'shell', '.py': 'python' }[extname(name)] || 'eslint';
      files[language].push(name);
      if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(name)) files.workflows.push(name);
    }
  }
  visit(root, false);
  for (const directory of readdirSync(root, { withFileTypes: true })) {
    if (directory.isDirectory() && ['scripts', '.github'].includes(directory.name)) visit(join(root, directory.name), true);
  }
  for (const paths of Object.values(files)) paths.sort();
  return files;
}

// Expressions belong to GitHub, not the embedded language. Never evaluate them.
export function maskExpressions(source) {
  return source.replace(/\$\{\{[\s\S]*?\}\}/g, match => 'EXPRESSION' + '\n'.repeat(match.split('\n').length - 1));
}

export function workflowScripts(source) {
  const workflow = yaml.load(source);
  const snippets = [];
  for (const [jobName, job] of Object.entries(workflow?.jobs || {})) {
    for (const [index, step] of (job.steps || []).entries()) {
      const label = `${jobName}.steps[${index}]`;
      if (typeof step.run === 'string') {
        const defaultShell = typeof job['runs-on'] === 'string' && job['runs-on'].startsWith('windows-') ? 'pwsh' : 'bash';
        const shell = step.shell || job.defaults?.run?.shell || workflow.defaults?.run?.shell || defaultShell;
        snippets.push({ label, language: shell.split(/\s/)[0], source: maskExpressions(step.run) });
      }
      if (/^actions\/github-script@/.test(step.uses || '') && typeof step.with?.script === 'string') {
        snippets.push({ label, language: 'javascript', source: maskExpressions(step.with.script) });
      }
    }
  }
  return snippets;
}

export async function lintSystem(root = repositoryRoot) {
  const files = systemFiles(root);
  let failed = false;
  const eslint = new ESLint({ cwd: root, overrideConfigFile: join(repositoryRoot, 'eslint.config.js') });
  const formatter = await eslint.loadFormatter('stylish');
  if (files.eslint.length) {
    const results = await eslint.lintFiles(files.eslint);
    const output = formatter.format(results);
    if (output) console.log(output);
    failed = results.some(result => result.errorCount || result.warningCount);
  }
  function shellcheck(args, input) {
    const result = spawnSync('shellcheck', ['--norc', ...args], { cwd: root, input, encoding: 'utf8' });
    if (result.stdout) console.log(result.stdout);
    if (result.stderr) console.error(result.stderr);
    if (result.error) console.error(`shellcheck: ${result.error.message}. Install requirements-lint.txt and activate its environment.`);
    if (result.error || result.status !== 0) failed = true;
  }
  if (files.shell.length) shellcheck(['--', ...files.shell]);
  if (files.python.length) {
    // Syntax only: do not import/execute the source or create bytecode caches.
    const result = spawnSync('python', ['-c',
      'import ast, pathlib, sys\nfor name in sys.argv[1:]:\n ast.parse(pathlib.Path(name).read_text(encoding="utf-8"), filename=name)',
      ...files.python], { cwd: root, encoding: 'utf8' });
    if (result.stderr) console.error(result.stderr);
    if (result.error) console.error(`python: ${result.error.message}. Activate the lint environment.`);
    if (result.error || result.status !== 0) failed = true;
  }

  const embedded = new ESLint({ cwd: root, overrideConfigFile: join(repositoryRoot, 'eslint.config.js'),
    overrideConfig: { languageOptions: { globals: Object.fromEntries([
      'github', 'context', 'core', 'exec', 'glob', 'io', 'require', '__dirname', '__filename',
      'EXPRESSION', // Neutral placeholder for unquoted GitHub expressions in JS.
    ].map(name => [name, 'readonly'])) } } });
  for (const file of files.workflows) {
    let snippets;
    try {
      snippets = workflowScripts(readFileSync(join(root, file), 'utf8'));
    } catch (error) {
      console.error(`${file}: ${error.message}`);
      failed = true;
      continue;
    }
    for (const snippet of snippets) {
      console.log(`${file}: ${snippet.label} (${snippet.language})`);
      if (snippet.language === 'javascript') {
        const results = await embedded.lintText(`(async () => {\n${snippet.source}\n})();`, { filePath: 'scripts/workflow-snippet.js' });
        const output = formatter.format(results);
        if (output) console.log(output);
        if (results.some(result => result.errorCount || result.warningCount)) failed = true;
      } else if (['bash', 'sh'].includes(snippet.language)) {
        shellcheck(['--shell', snippet.language, '--', '-'], snippet.source);
      } else {
        console.log(`Skipped unsupported embedded shell: ${snippet.language}`);
      }
    }
  }
  return failed ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await lintSystem();
