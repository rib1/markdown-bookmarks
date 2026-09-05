import { spawn } from 'node:child_process';

const BROWSER_ALIASES = {
  chrome: { win32: 'chrome.exe', darwin: 'Google Chrome', linux: 'google-chrome' },
  edge: { win32: 'msedge.exe', darwin: 'Microsoft Edge', linux: 'microsoft-edge' },
  firefox: { win32: 'firefox.exe', darwin: 'Firefox', linux: 'firefox' },
  brave: { win32: 'brave.exe', darwin: 'Brave Browser', linux: 'brave-browser' },
  safari: { darwin: 'Safari' }
};

function browserApplication(browser, platform) {
  const alias = BROWSER_ALIASES[browser.toLowerCase()];
  if (alias && !alias[platform]) throw new Error(`${browser} is not supported on ${platform}`);
  return alias?.[platform] || browser;
}

export function browserCommand(target, platform = process.platform, browser) {
  if (browser) {
    const application = browserApplication(browser, platform);
    if (platform === 'darwin') return { command: 'open', args: ['-a', application, target] };
    return { command: application, args: [target] };
  }
  if (platform === 'win32') {
    return { command: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', target] };
  }
  return { command: platform === 'darwin' ? 'open' : 'xdg-open', args: [target] };
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
