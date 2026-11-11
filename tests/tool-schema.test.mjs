import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameTool } from '../src/frame-tool.mjs';
import { createFilmTool } from '../src/film-tool.mjs';
import { createLibraryTool } from '../src/library-tool.mjs';
import { createGetTool } from '../src/get-tool.mjs';
import { createClipTool } from '../src/clip-tool.mjs';
import { createAssetsTool } from '../src/assets-tool.mjs';
import { createExportTool } from '../src/export-tool.mjs';
import { createCliTool } from '../src/cli-tool.mjs';
import { createDraftTool } from '../src/draft-tool.mjs';
import { createGuideTool } from '../src/guide-tool.mjs';

/*
 * DSH validates a plugin's tool schemas when the plugin loads and refuses the
 * whole plugin when one is wrong — which is how 0.7.0 first shipped "异常",
 * because `required` had been written per property instead of as an array.
 * These checks are deliberately the narrow subset a Host actually enforces, so
 * a schema mistake fails here in a second instead of at load time in the app.
 */
const link = { isProjectAgent: () => true, projectOf: () => ({ projectId: 'film123', path: 'C:/p' }) };
const http = () => ({ get: async () => ({}), post: async () => ({}), put: async () => ({}), del: async () => ({}), picture: async () => ({ bytes: new Uint8Array() }) });

const tools = [
  createFrameTool({ ...link, http, attachments: () => ({}), llm: () => undefined }),
  createFilmTool({ ...link, http }),
  createLibraryTool({ ...link, http }),
  createGetTool({ ...link, http }),
  createClipTool(link),
  createAssetsTool({ ...link, http }),
  createExportTool({ ...link, http }),
  createCliTool(link),
  createDraftTool(),
  createGuideTool(() => true),
];

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);

/** Walk one schema node, reporting every place a Host would reject it. */
function problems(schema, path = 'schema', out = []) {
  if (!isObject(schema)) { out.push(`${path} is not an object`); return out; }
  if (schema.type !== undefined && !TYPES.has(schema.type)) out.push(`${path}.type ${JSON.stringify(schema.type)} is unknown`);
  // `required` is a list of names on an object. `required: true` on a property is
  // the exact mistake DSH reports as "not supported on type ...".
  if (schema.required !== undefined) {
    if (!Array.isArray(schema.required)) out.push(`${path}.required must be an array, not ${JSON.stringify(schema.required)}`);
    else for (const name of schema.required) {
      if (typeof name !== 'string') out.push(`${path}.required holds a non-string`);
      else if (schema.properties && !(name in schema.properties)) out.push(`${path}.required names "${name}", which has no property`);
    }
  }
  if (schema.properties !== undefined) {
    if (!isObject(schema.properties)) out.push(`${path}.properties is not an object`);
    else for (const [name, child] of Object.entries(schema.properties)) problems(child, `${path}.properties.${name}`, out);
    if (schema.required !== undefined && Array.isArray(schema.required) && schema.type !== 'object') out.push(`${path} has required but is not an object`);
  }
  if (schema.items !== undefined) problems(schema.items, `${path}.items`, out);
  if (schema.enum !== undefined && !Array.isArray(schema.enum)) out.push(`${path}.enum is not an array`);
  if (schema.minimum !== undefined || schema.maximum !== undefined) {
    if (schema.type !== 'number' && schema.type !== 'integer') out.push(`${path} has a numeric bound but type ${schema.type}`);
  }
  return out;
}

for (const tool of tools) {
  test(`${tool.name} declares a schema a Host can load`, () => {
    assert.equal(typeof tool.name, 'string');
    assert.ok(tool.name.length > 0 && tool.name.length <= 40, tool.name);
    assert.ok(isObject(tool.parameters), `${tool.name}.parameters must be an object`);
    assert.deepEqual(problems(tool.parameters, `${tool.name}.parameters`), []);
    assert.ok(isObject(tool.output?.schema), `${tool.name}.output.schema must be an object`);
    assert.deepEqual(problems(tool.output.schema, `${tool.name}.output.schema`), []);
    const rendered = tool.output.render?.({}, { text: 'ok' });
    assert.ok(Array.isArray(rendered) && rendered.length > 0, `${tool.name}.output.render must return blocks`);
  });
}

test('the schema checker itself catches the mistake that broke 0.7.0', () => {
  const broken = { type: 'object', properties: { image: { type: 'object', properties: { id: { type: 'string', required: true } } } } };
  assert.match(problems(broken).join('\n'), /required must be an array/);
  assert.match(problems({ type: 'object', required: ['nope'], properties: {} }).join('\n'), /no property/);
});
