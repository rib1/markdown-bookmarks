import test from 'node:test';
import assert from 'node:assert/strict';
import { isOpenableBookmarkUrl } from '../src/browser-target.js';
import { browserCommand, browserWindowCommand, openInBrowserWindow } from '../src/browser-launcher.js';

test('accepts HTTP and absolute Windows/macOS local document URLs for browser opening', () => {
  const targets = [
    'https://example.test/page?a=1&b=2', 'http://localhost:5000/',
    'file:///C:/Example%20Documents/presentation.html',
    'file:///C:/Example/chart.svg#diagram',
    'file:///Users/example/Documents/report.pdf', 'file:///tmp/My%20Page.htm',
    'file:///tmp/kuva-%C3%A4.svg', 'file:///tmp/UPPER.SVG', 'file:///tmp/image.png'
  ];
  for (const target of targets) {
    assert.equal(isOpenableBookmarkUrl(target), true, target);
    assert.deepEqual(browserCommand(target, 'win32', 'chrome', { environment: {}, exists: () => false }), { command: 'chrome.exe', args: [target] });
    assert.deepEqual(browserCommand(target, 'darwin'), { command: 'open', args: [target] });
    assert.deepEqual(browserWindowCommand([target], 'linux', 'firefox'), { command: 'firefox', args: ['-new-window', target] });
  }
});

test('rejects executable schemes, network files, relative files, malformed and executable local targets', () => {
  for (const target of [
    '', undefined, 'javascript:alert(1)', 'data:text/html,hello', 'vbscript:msgbox(1)',
    'ftp://example.test/file', 'not-a-url', 'https://', 'https:example.test',
    'file:relative.html', 'file:/tmp/page.html', 'file://server/share/page.html',
    'file://localhost/tmp/page.html', 'file:////server/share/page.html',
    'file:///C:relative.html', 'file:///tmp/%2fserver/page.html', 'file:///tmp/%5cserver/page.html',
    'file:///tmp/%00page.html', 'file:///tmp/%0Apage.html', 'file:///tmp/%ZZpage.html',
    'file:///tmp/run.exe', 'file:///tmp/run.cmd', 'file:///tmp/run.ps1', 'file:///tmp/run.js',
    'file:///tmp/run.sh', 'file:///C:/Windows/System32/cmd.exe#page.html',
    'file:///C:/run.exe:page.html',
    'file:///tmp/page.html.exe', 'file:///tmp/page.svg/../../../run.exe',
    'https://example.test/\npage', 'file:///C:\\Example\\page.html'
  ]) {
    assert.equal(isOpenableBookmarkUrl(target), false, String(target));
    assert.throws(() => browserCommand(target, 'win32'), /Browser target must be/);
  }
});

test('checks every project URL before launching any browser process', () => {
  let launches = 0;
  const spawn = () => { launches++; throw new Error('Must not launch'); };
  for (const browser of [undefined, 'chrome']) {
    assert.throws(() => openInBrowserWindow(['file:///tmp/intro.svg', 'javascript:alert(1)'], browser, 'linux', spawn), /Browser target must be/);
  }
  assert.equal(launches, 0);
});
