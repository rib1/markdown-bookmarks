import { spawn } from 'node:child_process';
import fs from 'node:fs';

const BROWSER_ALIASES = {
  chrome: { win32: 'chrome.exe', darwin: 'Google Chrome', linux: 'google-chrome' },
  edge: { win32: 'msedge.exe', darwin: 'Microsoft Edge', linux: 'microsoft-edge' },
  firefox: { win32: 'firefox.exe', darwin: 'Firefox', linux: 'firefox' },
  brave: { win32: 'brave.exe', darwin: 'Brave Browser', linux: 'brave-browser' },
  safari: { darwin: 'Safari' }
};

function windowsChromeExecutable(environment, exists) {
  const candidates = [
    environment.ProgramFiles && `${environment.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
    environment['ProgramFiles(x86)'] && `${environment['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`,
    environment.LOCALAPPDATA && `${environment.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`
  ].filter(Boolean);
  return candidates.find((candidate) => exists(candidate));
}

function browserApplication(browser, platform, environment, exists) {
  const alias = BROWSER_ALIASES[browser.toLowerCase()];
  if (alias && !alias[platform]) throw new Error(`${browser} is not supported on ${platform}`);
  if (browser.toLowerCase() === 'chrome' && platform === 'win32') {
    return windowsChromeExecutable(environment, exists) || alias.win32;
  }
  return alias?.[platform] || browser;
}

export function browserCommand(target, platform = process.platform, browser, {
  environment = process.env,
  exists = fs.existsSync
} = {}) {
  if (browser) {
    const application = browserApplication(browser, platform, environment, exists);
    if (platform === 'darwin') return { command: 'open', args: ['-a', application, target] };
    return { command: application, args: [target] };
  }
  if (platform === 'win32') {
    return { command: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', target] };
  }
  return { command: platform === 'darwin' ? 'open' : 'xdg-open', args: [target] };
}

function windowArguments(browser, targets) {
  const alias = browser.toLowerCase();
  if (alias === 'firefox') return ['-new-window', ...targets];
  if (alias === 'safari') throw new Error('safari cannot be forced to open a new window');
  return ['--new-window', ...targets];
}

export function browserWindowCommand(targets, platform = process.platform, browser, options = {}) {
  if (!Array.isArray(targets) || !targets.length) throw new Error('At least one browser target is required');
  if (!browser) throw new Error('project open requires --with BROWSER to open in a new browser window');
  const application = browserApplication(browser, platform, options.environment || process.env, options.exists || fs.existsSync);
  const args = windowArguments(browser, targets);
  if (platform === 'darwin') return { command: 'open', args: ['-a', application, '--args', ...args] };
  return { command: application, args };
}

export function openInBrowser(target, browser, platform = process.platform, spawnProcess = spawn) {
  const { command, args } = browserCommand(target, platform, browser);
  return new Promise((resolve, reject) => {
    const child = spawnProcess(command, args, { detached: true, stdio: 'ignore' });
    child.once('error', reject);
    if (platform === 'darwin') {
      child.once('exit', (code) => {
        if (code === 0) resolve();
        else {
          const error = new Error(`macOS open command exited with code ${code}`);
          error.code = 'BROWSER_LAUNCH_FAILED';
          reject(error);
        }
      });
    } else {
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
    }
  });
}

export function openInBrowserWindow(targets, browser, platform = process.platform, spawnProcess = spawn) {
  const { command, args } = browserWindowCommand(targets, platform, browser);
  return new Promise((resolve, reject) => {
    const child = spawnProcess(command, args, { detached: true, stdio: 'ignore' });
    child.once('error', reject);
    if (platform === 'darwin') {
      child.once('exit', (code) => {
        if (code === 0) resolve();
        else {
          const error = new Error(`macOS open command exited with code ${code}`);
          error.code = 'BROWSER_LAUNCH_FAILED';
          reject(error);
        }
      });
    } else {
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
    }
  });
}
