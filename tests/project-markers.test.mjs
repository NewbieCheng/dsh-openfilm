// The marker that keeps a tool call from opening a browser window.
//
// The kernel CLI's `look` / `render` call `open(project)` when a project has no
// `.film/opened` file, and `open` starts Studio AND the person's browser. Inside
// DSH the film already has a window (the panel), so the Host writes the same
// empty marker the CLI writes: Studio has shown this project.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { markProjectOpened, OPENED_MARKER } from '../src/project-markers.mjs';

async function project() {
  return mkdtemp(join(tmpdir(), 'openfilm-opened-'));
}

test('a project gets the same empty marker the kernel CLI writes', async () => {
  const root = await project();
  try {
    assert.equal(await markProjectOpened(root), true);
    const bytes = await readFile(join(root, OPENED_MARKER));
    assert.equal(bytes.byteLength, 0, 'the kernel writes an empty file; its content is never read');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('marking twice keeps the first marker and does not fail', async () => {
  const root = await project();
  try {
    await markProjectOpened(root);
    const first = join(root, OPENED_MARKER);
    // A person's Studio may have touched it; the marker is presence, not content.
    await writeFile(first, 'shown 2026-11-12');
    assert.equal(await markProjectOpened(root), true);
    assert.equal(await readFile(first, 'utf8'), 'shown 2026-11-12');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a folder that cannot be written reports false instead of throwing', async () => {
  // A read-only or missing project must not break binding a conversation: the
  // CLI then just falls back to its own guard, which OPENFILM_NO_BROWSER covers.
  assert.equal(await markProjectOpened(''), false);
  assert.equal(await markProjectOpened('F:/Dev/Films/nope-not-here', {
    mkdirImpl: async () => { throw new Error('EACCES'); },
  }), false);
});

test('an existing .film directory is reused', async () => {
  const root = await project();
  try {
    await mkdir(join(root, '.film'), { recursive: true });
    await writeFile(join(root, '.film', 'history.json'), '{}');
    assert.equal(await markProjectOpened(root), true);
    await access(join(root, '.film', 'history.json'));
    await access(join(root, OPENED_MARKER));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
