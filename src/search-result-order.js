import { readScalar } from './bookmark-format.js';

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function metadataValue(content, field) {
  return readScalar(content, field);
}

export function sortSearchResults(results) {
  return [...results].sort((left, right) => {
    const scoreDifference = (right.matchScore ?? -1) - (left.matchScore ?? -1);
    if (scoreDifference) return scoreDifference;
    const leftTitle = String(metadataValue(left.content, 'title') || left.file);
    const rightTitle = String(metadataValue(right.content, 'title') || right.file);
    return compareText(leftTitle.toLowerCase(), rightTitle.toLowerCase())
      || compareText(leftTitle, rightTitle)
      || compareText(left.file, right.file);
  });
}
