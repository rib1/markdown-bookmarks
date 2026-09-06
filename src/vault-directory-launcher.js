import { spawn } from 'node:child_process';

function oneLine(value) {
  return String(value).replace(/[\r\n]/g, ' ');
}

function quoted(value) {
  return `"${oneLine(value).replaceAll('"', '\\"')}"`;
}

export function directoryCommand(directory, platform = process.platform) {
  if (platform === 'win32') return { command: 'explorer.exe', args: [directory] };
  return { command: platform === 'darwin' ? 'open' : 'xdg-open', args: [directory] };
}

export function formatDirectoryCommand(directory, platform = process.platform) {
  const { command } = directoryCommand(directory, platform);
  return `${command} ${quoted(directory)}`;
}

export function hostDirectoryCommands(directory) {
  if (/^[a-z]:[\\/]/i.test(directory)) return [formatDirectoryCommand(directory, 'win32')];
  return [
    `macOS: ${formatDirectoryCommand(directory, 'darwin')}`,
    `Linux: ${formatDirectoryCommand(directory, 'linux')}`
  ];
}

export function openDirectory(directory, platform = process.platform, spawnProcess = spawn) {
  const { command, args } = directoryCommand(directory, platform);
  return new Promise((resolve, reject) => {
    const child = spawnProcess(command, args, { detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}
