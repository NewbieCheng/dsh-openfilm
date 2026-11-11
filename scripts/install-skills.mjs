/**
 * Mirror this package's `skills/` folder into the DSH home so the editing session can see it.
 *
 * `@deepseek-ai/dsh-skill-filesystem` scans roots in a fixed rank order (project `.dsh/skills`,
 * `<project>/.agents/skills`, `customSkillDirs`, `<dshHome>/skills`, `<agentsHome>/skills`). The DSH
 * home root is the one a person can also edit by hand, and it watches its roots, so a skill added
 * there appears in the next catalog without a restart. That is why this copies there and nowhere else.
 *
 *   node scripts/install-skills.mjs            copy what is missing, leave the rest alone
 *   node scripts/install-skills.mjs --force    overwrite (our own skills only)
 *   node scripts/install-skills.mjs --print    show what would happen
 *
 * A skill is a directory `<name>/SKILL.md` with YAML frontmatter (`name`, `description` required).
 * Adding a style later — "hand-drawn notes", "product demo" — is one more folder here, then this
 * script again, or the same folder dropped straight into <dshHome>/skills by hand.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, '..', 'skills');
const home = process.env.DSH_HOME || join(homedir(), '.dsh');
const target = join(home, 'skills');

const args = new Set(process.argv.slice(2));
const force = args.has('--force');
const print = args.has('--print');

function log(message) {
  process.stdout.write(message + '\n');
}

/** The name a skill declares, so a folder copied here keeps the name the model sees. */
function declaredName(file) {
  const text = readFileSync(file, 'utf8');
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return null;
  const name = /^name:\s*(.+)$/m.exec(match[1]);
  const description = /^description:\s*(.+)$/m.exec(match[1]);
  if (!name || !description) return null;
  return name[1].trim().replace(/^["']|["']$/g, '');
}

if (!existsSync(source)) {
  log('no skills/ folder next to this script — nothing to install');
  process.exit(0);
}

const found = readdirSync(source).filter((entry) => statSync(join(source, entry)).isDirectory());
if (found.length === 0) {
  log('skills/ has no skill folders — nothing to install');
  process.exit(0);
}

let installed = 0;
let skipped = 0;
for (const folder of found) {
  const file = join(source, folder, 'SKILL.md');
  if (!existsSync(file)) {
    log(`skip ${folder}: no SKILL.md`);
    skipped += 1;
    continue;
  }
  const name = declaredName(file);
  if (!name) {
    log(`skip ${folder}: SKILL.md needs YAML frontmatter with name and description`);
    skipped += 1;
    continue;
  }
  const to = join(target, name);
  const dest = join(to, 'SKILL.md');
  if (existsSync(dest) && !force) {
    log(`keep ${name}: already installed (--force overwrites)`);
    skipped += 1;
    continue;
  }
  if (print) {
    log(`would install ${name} -> ${dest}`);
    continue;
  }
  mkdirSync(to, { recursive: true });
  copyFileSync(file, dest);
  installed += 1;
  log(`installed ${name} -> ${dest}`);
}

log(`${installed} installed, ${skipped} skipped, target ${target}`);
