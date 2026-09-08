function withoutTerminalControls(value) {
  const escape = String.fromCharCode(27);
  const ansiSequence = new RegExp(`${escape}\\[[0-?]*[ -/]*[@-~]`, 'g');
  return [...String(value ?? '').replace(ansiSequence, '')].map((character) => {
    const code = character.codePointAt(0);
    return code <= 31 || (code >= 127 && code <= 159) ? ' ' : character;
  }).join('');
}

export function oneLine(value, maximum = 500) {
  const cleaned = withoutTerminalControls(value).replace(/\s+/g, ' ').trim();
  return cleaned.length > maximum ? `${cleaned.slice(0, maximum - 1)}…` : cleaned;
}

export function commandPath(value) {
  return withoutTerminalControls(value);
}

export function vaultPathLines(root, { hostRoot } = {}) {
  return hostRoot
    ? [`Vault (host): ${oneLine(hostRoot)}`, `Vault (container): ${oneLine(root)}`]
    : [`Vault: ${oneLine(root)}`];
}
