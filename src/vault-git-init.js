import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { normalizeLineEndings } from './bookmark-format.js';

const run = promisify(execFile);
const ATTRIBUTES = '* text=auto eol=lf';
const EDITORCONFIG = 'root = true\n\n[*]\ncharset = utf-8\nend_of_line = lf\ninsert_final_newline = true\n';

export async function installVaultLineEndingDefaults(root) {
  const attributes = path.join(root, '.gitattributes');
  let content = '';
  try { content = await fs.readFile(attributes, 'utf8'); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const normalized = normalizeLineEndings(content);
  // Establish the default before user-specific overrides such as binary rules.
  const updated = normalized.split('\n').some((line) => line.trim() === ATTRIBUTES)
    ? normalized : `${ATTRIBUTES}\n${normalized}`;
  if (content !== updated) await fs.writeFile(attributes, updated, 'utf8');
  const editorconfig = path.join(root, '.editorconfig');
  try {
    const original = await fs.readFile(editorconfig, 'utf8');
    const lf = normalizeLineEndings(original);
    if (lf !== original) await fs.writeFile(editorconfig, lf, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await fs.writeFile(editorconfig, EDITORCONFIG, 'utf8');
  }
}

export async function initializeVaultGit(root) {
  const absoluteRoot = path.resolve(root);
  let initialized = false;
  try {
    try { await fs.access(path.join(absoluteRoot, '.git')); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await run('git', ['init', '--initial-branch=main', '--', absoluteRoot]);
      initialized = true;
    }
    const { stdout } = await run('git', ['-C', absoluteRoot, 'rev-parse', '--show-toplevel']);
    if (await fs.realpath(stdout.trim()) !== await fs.realpath(absoluteRoot)) {
      throw new Error('Refusing to configure Git outside the selected vault');
    }
    await run('git', ['-C', absoluteRoot, 'config', '--local', 'core.autocrlf', 'false']);
    await run('git', ['-C', absoluteRoot, 'config', '--local', 'core.eol', 'lf']);
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('Git was not found. Install Git on the host to use vault init --git.', { cause: error });
    throw error;
  }
  return { initialized };
}
