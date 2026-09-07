function normalizeTag(value) {
  return String(value ?? '').trim().toLocaleLowerCase('en');
}

function tagLength(value) {
  return [...normalizeTag(value)].length;
}

function withoutPunctuation(value) {
  return normalizeTag(value).replace(/[\p{P}\p{S}]/gu, '');
}

function isPunctuationVariant(left, right) {
  const leftPlain = withoutPunctuation(left.tag);
  const rightPlain = withoutPunctuation(right.tag);
  return Boolean(leftPlain) && leftPlain === rightPlain && left.tag !== right.tag;
}

export function levenshteinDistance(leftValue, rightValue) {
  const left = [...normalizeTag(leftValue)];
  const right = [...normalizeTag(rightValue)];
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row++) {
    const current = [row];
    for (let column = 1; column <= right.length; column++) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[right.length];
}

export function tagDistanceLimit(leftValue, rightValue) {
  const longest = Math.max(tagLength(leftValue), tagLength(rightValue));
  return longest >= 9 ? 2 : 1;
}

export function buildTagVocabulary(records) {
  const vocabulary = new Map();
  for (const record of records) {
    const seen = new Set();
    for (const value of record.tags) {
      const tag = normalizeTag(value);
      if (!tag || seen.has(tag)) continue;
      seen.add(tag);
      const entry = vocabulary.get(tag) || { tag, count: 0, records: [] };
      entry.count++;
      entry.records.push({ id: record.id, file: record.file });
      vocabulary.set(tag, entry);
    }
  }
  return [...vocabulary.values()].sort((left, right) => left.tag.localeCompare(right.tag, 'en'));
}

function sharedRecords(left, right) {
  const rightFiles = new Set(right.records.map((record) => record.file));
  return left.records.filter((record) => rightFiles.has(record.file));
}

function orientPair(left, right) {
  if (left.count !== right.count) {
    return left.count < right.count
      ? { source: left, canonical: right }
      : { source: right, canonical: left };
  }
  if (isPunctuationVariant(left, right)) {
    const leftPunctuation = tagLength(left.tag) - tagLength(withoutPunctuation(left.tag));
    const rightPunctuation = tagLength(right.tag) - tagLength(withoutPunctuation(right.tag));
    if (leftPunctuation !== rightPunctuation) {
      return leftPunctuation > rightPunctuation
        ? { source: left, canonical: right }
        : { source: right, canonical: left };
    }
  }
  return { source: undefined, canonical: undefined };
}

export function isHighConfidenceTagTypo(candidate) {
  if (isPunctuationVariant(candidate.left, candidate.right)) return true;
  if (!candidate.source || !candidate.canonical) return false;
  return candidate.source.count <= 3
    && candidate.canonical.count > 3
    && Math.min(tagLength(candidate.source.tag), tagLength(candidate.canonical.tag)) >= 4;
}

export function findLikelyTagTypos(records) {
  const vocabulary = buildTagVocabulary(records);
  const candidates = [];
  for (let leftIndex = 0; leftIndex < vocabulary.length; leftIndex++) {
    const left = vocabulary[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < vocabulary.length; rightIndex++) {
      const right = vocabulary[rightIndex];
      const limit = tagDistanceLimit(left.tag, right.tag);
      if (Math.abs(tagLength(left.tag) - tagLength(right.tag)) > limit) continue;
      const distance = levenshteinDistance(left.tag, right.tag);
      if (distance === 0 || distance > limit) continue;
      candidates.push({ left, right, distance, overlap: sharedRecords(left, right), ...orientPair(left, right) });
    }
  }
  candidates.sort((left, right) => left.distance - right.distance
    || Math.min(left.left.count, left.right.count) - Math.min(right.left.count, right.right.count)
    || left.left.tag.localeCompare(right.left.tag, 'en')
    || left.right.tag.localeCompare(right.right.tag, 'en'));
  const likelyCandidates = candidates.filter(isHighConfidenceTagTypo);
  return { tagCount: vocabulary.length, vocabulary, candidates, likelyCandidates };
}
