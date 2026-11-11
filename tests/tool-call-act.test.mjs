import test from 'node:test';
import assert from 'node:assert/strict';
import { describeToolCall, planFromTodoWrite, parseArguments } from '../src/tool-call-act.mjs';

test('a read names its file in every place the shell looks', () => {
  const act = describeToolCall({ name: 'read', input: '{"file_path":"film.html"}' });
  assert.equal(act.kind, 'read');
  assert.deepEqual(act.rawInput, { path: 'film.html' });
  assert.deepEqual(act.locations, [{ path: 'film.html' }]);
  // The same call through the deployment's prefixed name.
  assert.equal(describeToolCall({ name: 'ops_read_files', input: { files: ['a.md'] } }).kind, 'read');
});

test('a command stays a command, string or argv', () => {
  const one = describeToolCall({ name: 'pwsh', input: '{"command":"Get-ChildItem"}' });
  assert.equal(one.kind, 'execute');
  assert.equal(one.rawInput.command, 'Get-ChildItem');
  const many = describeToolCall({ name: 'bash', input: { command: ['bash', '-lc', 'ls -la'] } });
  assert.deepEqual(many.rawInput.command, ['bash', '-lc', 'ls -la']);
});

test('a search keeps one usable pattern', () => {
  assert.deepEqual(describeToolCall({ name: 'glob', input: '{"pattern":["*.mjs","*.js"]}' }).rawInput, { pattern: '*.mjs *.js' });
  assert.deepEqual(describeToolCall({ name: 'grep', input: { pattern: 'TODO', path: 'src' } }).rawInput, { pattern: 'TODO', path: 'src' });
});

test('an edit names the file it touches', () => {
  const act = describeToolCall({ name: 'apply_patch', input: { path: 'film.html', patch: 'x'.repeat(2000) } });
  assert.equal(act.kind, 'edit');
  assert.deepEqual(act.rawInput, { path: 'film.html' });
  assert.equal(describeToolCall({ name: 'str_replace_editor', input: { path: 'a.html' } }).kind, 'edit');
});

test('fetches separate search from read', () => {
  assert.deepEqual(describeToolCall({ name: 'web_search', input: { query: 'cc0 transitions' } }).rawInput, { query: 'cc0 transitions' });
  assert.equal(describeToolCall({ name: 'web_fetch', input: { url: 'https://x.test' } }).rawInput.url, 'https://x.test');
});

test('our own tools borrow the shell verb that means the same thing', () => {
  const frame = describeToolCall({ name: 'openfilm_frame', input: { at: 12.5 } });
  assert.equal(frame.title, 'openfilm:look');
  assert.deepEqual(frame.rawInput, { at: 12.5 });
  assert.equal(describeToolCall({ name: 'openfilm_film', input: {} }).title, 'openfilm:check');
  const exported = describeToolCall({ name: 'openfilm_export', input: { target: '1080p' } });
  assert.equal(exported.kind, 'execute');
  assert.deepEqual(exported.rawInput.command, ['openfilm', 'render', '1080p']);
  const clip = describeToolCall({ name: 'openfilm_clip', input: { path: 'film.html' } });
  assert.equal(clip.kind, 'edit');
  assert.deepEqual(clip.locations, [{ path: 'film.html' }]);
});

test('an unknown tool still says which file or what it got', () => {
  const act = describeToolCall({ name: 'mystery_tool', input: { path: 'a.png', depth: 3 } });
  assert.equal(act.kind, 'other');
  assert.deepEqual(act.rawInput, { path: 'a.png', depth: 3 });
  assert.equal(act.title, 'mystery_tool');
});

test('hostile or huge arguments are clamped, never echoed whole', () => {
  const huge = { text: 'x'.repeat(5000), __proto__: { polluted: true }, nested: { a: { b: { c: 1 } } } };
  const act = describeToolCall({ name: 'mystery_tool', input: JSON.stringify(huge) });
  assert.ok(act.rawInput.text.length <= 301);
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(typeof act.rawInput, 'object');
  // Unparseable JSON still yields an object, not a string.
  assert.deepEqual(describeToolCall({ name: 'read', input: '{not json' }).rawInput.path, undefined);
});

test('todo_write becomes a plan, and only when it carries a list', () => {
  assert.deepEqual(planFromTodoWrite('{"todos":[{"content":"看片","status":"in_progress"},{"content":"改片","status":"pending"},{"content":"","status":"completed"}]}'), [
    { content: '看片', status: 'in_progress' },
    { content: '改片', status: 'pending' },
  ]);
  assert.equal(planFromTodoWrite('{"todos":[]}'), undefined);
  assert.equal(planFromTodoWrite('{"other":1}'), undefined);
  assert.equal(planFromTodoWrite('nope'), undefined);
  // An unknown status degrades to pending rather than dropping the line.
  assert.deepEqual(planFromTodoWrite({ todos: [{ content: 'x', status: 'weird' }] }), [{ content: 'x', status: 'pending' }]);
});

test('arguments parse from both recorded shapes', () => {
  assert.deepEqual(parseArguments('{"a":1}'), { a: 1 });
  assert.deepEqual(parseArguments({ a: 1 }), { a: 1 });
  assert.deepEqual(parseArguments('[1,2]'), {});
  assert.deepEqual(parseArguments('"text"'), {});
  assert.deepEqual(parseArguments(undefined), {});
});
