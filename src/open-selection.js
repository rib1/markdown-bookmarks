export const CANCELLED_SELECTION = Symbol('cancelled-selection');

export function pickedResult(results, value) {
  const pick = Number(value);
  if (!Number.isInteger(pick) || pick < 1 || pick > results.length) {
    throw new Error(`--pick must be a number from 1 to ${results.length}`);
  }
  return results[pick - 1];
}

export function interactiveResult(results, value) {
  if (!String(value ?? '').trim()) return CANCELLED_SELECTION;
  return pickedResult(results, value);
}
