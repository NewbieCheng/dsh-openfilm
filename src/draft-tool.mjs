import { draftFilm } from './film-draft.mjs';

const MAX_TOOL_BYTES = 64 * 1024;
const size = (text) => new TextEncoder().encode(text).byteLength;
const operation = {
  oneOf: [
    { type: 'object', additionalProperties: false, required: ['op', 'clip', 'at'], properties: { op: { const: 'move' }, clip: { type: 'string' }, at: { type: 'number' }, track: { type: 'integer' } } },
    { type: 'object', additionalProperties: false, required: ['op', 'clip', 'start', 'end'], properties: { op: { const: 'trim' }, clip: { type: 'string' }, start: { type: 'number' }, end: { type: 'number' } } },
    { type: 'object', additionalProperties: false, required: ['op', 'clip', 'at'], properties: { op: { const: 'split' }, clip: { type: 'string' }, at: { type: 'number' }, rightId: { type: 'string' } } },
  ],
};

/** Pure draft operation: callers must explicitly persist the returned text separately. */
export function createDraftTool() {
  return {
    name: 'openfilm_draft',
    description: 'Prepare an in-memory OpenFilm film.html edit; returns the complete edited source without saving or executing it. Supports move, trim, and split for compatible clips; locked tracks and unsupported dependent metadata are refused. Read the existing file first, review the result, and use an authorized file tool to save it.',
    parameters: {
      type: 'object', additionalProperties: false, required: ['source', 'operations'],
      properties: {
        source: { type: 'string', description: 'Complete UTF-8 film.html source, at most 64 KiB.' },
        operations: { type: 'array', maxItems: 100, items: operation, description: 'Move uses film seconds; trim uses source seconds; split uses film seconds. Track indexes are zero-based.' },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string' } } },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    isConcurrencySafe: () => true,
    async execute(args) {
      if (!args || typeof args.source !== 'string' || size(args.source) > MAX_TOOL_BYTES) throw new Error('film.html source must be at most 64 KiB');
      if (!Array.isArray(args.operations) || args.operations.length === 0 || args.operations.length > 100) throw new Error('Provide 1 to 100 operations');
      const { text } = draftFilm(args);
      if (size(text) > MAX_TOOL_BYTES) throw new Error('Edited source exceeds the 64 KiB tool output limit');
      return { text };
    },
  };
}
