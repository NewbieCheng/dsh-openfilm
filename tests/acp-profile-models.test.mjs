import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyAcpModelProviders } from '../src/acp-profile-models.mjs';

const PATCH = `# profile patch
- id: agent-default-model
  name: "@deepseek-ai/dsh-agent-default-model"
  config:
    provider: opencode-go
    model: deepseek-v4.1-flash
- id: llm-pi-ai
  name: "@deepseek-ai/dsh-llm-pi-ai"
  config:
    providers:
      opencode-go:
        models:
          - id: deepseek-v4.1-flash
            name: DeepSeek V4.1 Flash
        apiKeyEnv: OPENCODE_GO_API_KEY
`;

function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'dsh-home-'));
  const profiles = join(home, 'profiles');
  mkdirSync(join(profiles, 'desktop'), { recursive: true });
  mkdirSync(join(profiles, 'acp'), { recursive: true });
  writeFileSync(join(profiles, 'desktop', 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['dsh-openfilm'] } } }));
  writeFileSync(join(profiles, 'desktop', 'cordis.patch.yml'), PATCH);
  writeFileSync(join(profiles, 'acp', 'cordis.patch.yml'), '# empty\n[]\n');
  return { home, profiles };
}

test('the panel profile gets the desktop channels, once', () => {
  const { home, profiles } = fixture();
  try {
    const first = applyAcpModelProviders({ env: { DSH_HOME: home }, home });
    assert.equal(first.patched, true);
    const target = readFileSync(join(profiles, 'acp', 'cordis.patch.yml'), 'utf8');
    assert.match(target, /^- id: llm-pi-ai/m);
    assert.match(target, /opencode-go/);
    assert.doesNotMatch(target, /^- id: agent-default-model/m);
    assert.doesNotMatch(target, /^\[\]$/m);

    const second = applyAcpModelProviders({ env: { DSH_HOME: home }, home });
    assert.equal(second.patched, false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('a user entry in the acp patch survives a re-sync', () => {
  const { home, profiles } = fixture();
  try {
    writeFileSync(join(profiles, 'acp', 'cordis.patch.yml'), '- id: custom\n  config:\n    value: 1\n');
    applyAcpModelProviders({ env: { DSH_HOME: home }, home });
    const target = readFileSync(join(profiles, 'acp', 'cordis.patch.yml'), 'utf8');
    assert.match(target, /- id: custom/);
    assert.match(target, /- id: llm-pi-ai/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
