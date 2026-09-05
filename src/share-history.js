import crypto from 'node:crypto';

function optionalText(value, field, maximumLength) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > maximumLength) throw new Error(`${field} must be at most ${maximumLength} characters`);
  if (/\p{Cc}/u.test(normalized)) throw new Error(`${field} must not contain control characters`);
  return normalized;
}

export function createShareEvent(input, receivedAt) {
  const sender = optionalText(input.shared_by, 'shared_by', 200);
  const channel = optionalText(input.shared_via, 'shared_via', 80);
  if (!sender && !channel) return undefined;
  const id = optionalText(input.share_event_id, 'share_event_id', 128) || crypto.randomUUID();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
    throw new Error('share_event_id must contain only letters, numbers, dots, underscores, and hyphens');
  }
  return {
    id,
    ...(sender ? { sender } : {}),
    ...(channel ? { channel } : {}),
    received_at: receivedAt,
    source: 'manual',
    confidence: 'confirmed'
  };
}

export function appendShareEvent(history, event) {
  if (!event) return { history, added: false };
  const existing = history.find((entry) => entry && typeof entry === 'object' && entry.id === event.id);
  if (!existing) return { history: [...history, event], added: true };
  if (existing.sender !== event.sender || existing.channel !== event.channel) {
    throw new Error(`share_event_id ${event.id} already exists with different sender information`);
  }
  return { history, added: false };
}

export function shareHistoryLabels(history) {
  return history.filter((entry) => entry && typeof entry === 'object').map((entry) => {
    if (entry.sender && entry.channel) return `${entry.sender} via ${entry.channel}`;
    return entry.sender || entry.channel;
  }).filter(Boolean);
}

export function shareHistorySearchText(history) {
  return history.filter((entry) => entry && typeof entry === 'object')
    .flatMap((entry) => [entry.sender, entry.channel]).filter(Boolean).join(' ');
}
