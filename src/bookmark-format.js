export function normalizeUrl(value) {
  const url = new URL(value);
  url.hash = '';
  if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/$/, '');
  return url.toString();
}

export function normalizeTags(values = []) {
  const normalized = values.map(String).map((value) => value.trim().toLowerCase()).filter(Boolean);
  return [...new Set(normalized)];
}

export function yamlList(values) {
  return values.length ? values.map((value) => `  - ${JSON.stringify(value)}`).join('\n') : '  []';
}

export function replaceScalar(content, field, value) {
  const line = `${field}: ${JSON.stringify(value)}`;
  const pattern = new RegExp(`^${field}:.*$`, 'm');
  return pattern.test(content) ? content.replace(pattern, line) : content.replace(/^---\n/, `---\n${line}\n`);
}

export function readScalar(content, field) {
  const match = content.match(new RegExp(`^${field}:\\s*(.*?)\\s*$`, 'm'));
  if (!match) return undefined;
  const value = match[1];
  try { return JSON.parse(value); } catch { return value.replace(/^["']|["']$/g, ''); }
}

export function removeScalar(content, field) {
  return content.replace(new RegExp(`^${field}:.*(?:\\n|$)`, 'm'), '');
}

export function replaceList(content, field, values) {
  const block = `${field}:\n${yamlList(values)}\n`;
  const pattern = new RegExp(`^${field}:\\n(?:  - .*\\n|  \\[\\]\\n)*`, 'm');
  if (pattern.test(content)) return content.replace(pattern, block);
  if (/^tags:/m.test(content)) return content.replace(/^tags:/m, `${block}tags:`);
  return content.replace(/^---\n/, `---\n${block}`);
}

export function readList(content, field) {
  const match = content.match(new RegExp(`^${field}:\\r?\\n((?: {2}(?:- [^\\r\\n]*|\\[\\])\\r?\\n?)*)`, 'm'));
  if (!match) return [];
  return [...match[1].matchAll(/^ {2}- (.+?)\r?$/gm)].map((item) => {
    try { return JSON.parse(item[1]); } catch { return item[1].replace(/^["']|["']$/g, ''); }
  });
}
