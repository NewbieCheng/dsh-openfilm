import { draftFilm } from './film-draft.mjs';

export const MAX_DRAFT_OPERATIONS = 100;

/** An in-memory draft tied to a single observed file version. No files are changed. */
export function startDraft(source, version) {
  if (typeof source !== 'string' || typeof version !== 'string' || !version) throw new TypeError('A complete source and its version are required');
  return { originalText: source, originalVersion: version, operations: [], text: source };
}

/** Replay from the observed source, so a later save can reproduce the same result. */
export function appendDraft(draft, operation) {
  if (!draft || !Array.isArray(draft.operations) || draft.operations.length >= MAX_DRAFT_OPERATIONS) throw new Error('Draft operation limit reached');
  const operations = [...draft.operations, structuredClone(operation)];
  const { text } = draftFilm({ source: draft.originalText, operations });
  return { ...draft, operations, text };
}

export function undoDraft(draft) {
  if (!draft || !Array.isArray(draft.operations) || !draft.operations.length) return draft;
  const operations = draft.operations.slice(0, -1);
  const text = operations.length ? draftFilm({ source: draft.originalText, operations }).text : draft.originalText;
  return { ...draft, operations, text };
}
