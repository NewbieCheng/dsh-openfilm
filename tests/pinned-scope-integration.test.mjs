// Optional integration against a read-only pinned DSH checkout; never loads a profile.
// Run: DSH_PINNED_SOURCE=/absolute/path/to/vendor/dsh node --test tests/pinned-scope-integration.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { apply as applyPrompt } from '../src/openfilm-prompt.mjs';

const root = process.env.DSH_PINNED_SOURCE;
test('pinned Cordis scope confines the real OpenFilm prompt and disposes it', { skip: !root && 'set DSH_PINNED_SOURCE to the pinned DSH source checkout' }, async () => {
  const at = (...parts) => path.join(root, ...parts);
  const exports = [
    at('vendor/cordis/src/index.ts'),
    at('packages/core/scope/src/index.ts'),
    at('packages/core/system-prompt/src/index.ts'),
    at('vendor/loader/src/index.ts'),
  ];
  const result = await build({
    stdin: { contents: exports.map(p => `export * from ${JSON.stringify(p.replaceAll('\\', '/'))};`).join('\n'), resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, metafile: true, platform: 'node', format: 'esm',
    alias: {
      '@deepseek-ai/cordis': exports[0],
      '@deepseek-ai/cosmokit': at('vendor/cosmokit/src/index.ts'),
      '@deepseek-ai/schemastery': at('vendor/schemastery/src/index.ts'),
      '@deepseek-ai/dsh-scope': exports[1],
    },
  });
  assert.ok(Object.keys(result.metafile.inputs).every(input => !input.replaceAll('\\', '/').includes('/node_modules/')), 'bundle must not consume vendor node_modules');
  const runtime = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`);
  // This checks Loader evaluation of the literal expressions, not YAML parsing.
  const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8');
  const expressions = [...patch.matchAll(/disabled: !!js ([^\r\n]+)/g)].map(match => match[1]);
  assert.equal(expressions.length, 2);
  for (const platform of ['win32', 'linux']) {
    const values = expressions.map(expr => runtime.evaluate({ process: { platform } }, expr));
    assert.deepEqual(values, platform === 'win32' ? [true, false] : [false, true]);
  }
  const ctx = new runtime.Context();
  await ctx.plugin(runtime.SystemPrompt, {});
  let video, other;
  await ctx.plugin(Object.assign(inner => {
    video = runtime.createScope(inner, {});
    other = runtime.createScope(inner, {});
  }, { inject: ['systemPrompt'] }));
  applyPrompt(video.ctx);
  const render = async scope => runtime.renderPrompt(await ctx.systemPrompt.assemble(scope ? { scope: runtime.scopeOf(scope.ctx) } : {}));
  assert.match(await render(video), /openfilm_draft/);
  assert.doesNotMatch(await render(), /openfilm_draft/);
  assert.doesNotMatch(await render(other), /openfilm_draft/);
  const key = runtime.scopeOf(video.ctx);
  await video.dispose();
  assert.doesNotMatch(runtime.renderPrompt(await ctx.systemPrompt.assemble({ scope: key })), /openfilm_draft/);
  await other.dispose();
});
