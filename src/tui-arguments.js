export class TuiArgumentError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TuiArgumentError';
    this.code = code;
  }
}

export function argumentError(code, message) {
  return new TuiArgumentError(code, message);
}

export function parseTuiArguments(args, { options = {}, maximumPositionals = 0 } = {}) {
  if (args.some((token) => token === '--help' || token === '-h')) return { help: true, positionals: [] };

  const result = { help: false, positionals: [] };
  const seen = new Set();
  for (const definition of Object.values(options)) {
    if (definition.type === 'boolean') result[definition.key] = false;
  }

  let optionsEnded = false;
  for (let index = 0; index < args.length; index++) {
    const token = args[index];
    if (!optionsEnded && token === '--') {
      optionsEnded = true;
      continue;
    }
    if (!optionsEnded && token.startsWith('-')) {
      const separator = token.indexOf('=');
      const name = separator >= 0 ? token.slice(0, separator) : token;
      const inlineValue = separator >= 0 ? token.slice(separator + 1) : undefined;
      const definition = options[name];
      if (!definition) throw argumentError('unknown_option', `Unknown option for this command: ${name}`);
      if (seen.has(definition.key)) throw argumentError('duplicate_option', `Option may only be provided once: ${name}`);
      seen.add(definition.key);

      if (definition.type === 'boolean') {
        if (inlineValue !== undefined) {
          throw argumentError('unexpected_option_value', `${name} does not accept a value`);
        }
        result[definition.key] = true;
        continue;
      }

      let value = inlineValue;
      if (value === undefined) {
        const candidate = args[index + 1];
        if (candidate === undefined || candidate.startsWith('-')) {
          throw argumentError('missing_option_value', `${name} requires ${definition.valueLabel || 'a value'}`);
        }
        value = candidate;
        index++;
      }
      if (!value) throw argumentError('missing_option_value', `${name} requires ${definition.valueLabel || 'a value'}`);
      result[definition.key] = value;
      continue;
    }

    result.positionals.push(token);
    if (result.positionals.length > maximumPositionals) {
      throw argumentError('extra_positional', `Unexpected extra argument: ${JSON.stringify(token)}. Quote multiword values.`);
    }
  }
  return result;
}
