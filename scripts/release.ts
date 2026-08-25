/**
 * Cuts a release: bump the version, tag it, push both.
 *
 *   npm run release -- patch          # 0.1.1 -> 0.1.2
 *   npm run release -- minor|major
 *   npm run release -- 1.4.0          # an explicit version
 *   npm run release -- patch --dry-run
 *
 * Pushing the tag is what builds installers for three operating systems and
 * publishes them to a GitHub Release, so most of this file is the checks that
 * run *before* anything is written. A release that fails halfway leaves a tag
 * on the remote that has to be deleted by hand, and a version bump on `main`
 * that never produced a build — both are more annoying to undo than to prevent.
 *
 * `npm version` does the bump, the commit and the tag in one step, and creates
 * an *annotated* tag because a message is passed, which is what makes
 * `git push --follow-tags` send it. The commit message is a single line with a
 * conventional prefix; see `.claude/skills/dd-desktop-conventions`.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const skipSmoke = args.includes('--skip-smoke');
const bump = args.find((a) => !a.startsWith('--'));

function fail(message: string): never {
  console.error(`\nrelease: ${message}\n`);
  process.exit(1);
}

const step = (message: string) => console.log(`\n\x1b[1m→ ${message}\x1b[0m`);

/** Captured, trimmed, and never allowed to kill the script — callers decide what a failure means. */
function git(...argv: string[]): string {
  try {
    return execFileSync('git', argv, { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function run(command: string, argv: string[]): void {
  execFileSync(command, argv, { cwd: root, stdio: 'inherit' });
}

// --- what version are we going to ------------------------------------------

const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string };
const current = manifest.version;

function nextVersion(from: string, how: string): string {
  if (/^\d+\.\d+\.\d+$/.test(how)) return how;

  const parts = from.split('.').map(Number);
  const [major = 0, minor = 0, patch = 0] = parts;
  if (parts.length !== 3 || parts.some(Number.isNaN)) fail(`cannot parse the current version "${from}"`);

  if (how === 'major') return `${major + 1}.0.0`;
  if (how === 'minor') return `${major}.${minor + 1}.0`;
  if (how === 'patch') return `${major}.${minor}.${patch + 1}`;
  return fail(`unknown bump "${how}" — expected major, minor, patch, or an explicit x.y.z`);
}

if (!bump) {
  fail(
    'usage: npm run release -- <major|minor|patch|x.y.z> [--dry-run] [--skip-smoke]\n' +
      `  current version: ${current}`,
  );
}

const version = nextVersion(current, bump);
const tag = `v${version}`;

console.log(`\nrelease: ${current} → ${version}  (tag ${tag})${dryRun ? '  [DRY RUN]' : ''}`);

// --- preflight: the repository ---------------------------------------------

step('Checking the repository');

const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
if (branch !== 'main') fail(`on branch "${branch}" — releases are cut from main`);

if (git('status', '--porcelain') !== '') {
  fail('the working tree has uncommitted changes — commit or stash them first');
}

// A release built from a commit the remote does not have would fail at checkout,
// and a `main` that is behind cannot be pushed at all. Both are worth one fetch.
if (git('fetch', '--tags', 'origin') === '' && git('rev-parse', 'origin/main') === '') {
  fail('cannot reach origin — check your network and credentials');
}

const behind = git('rev-list', '--count', 'HEAD..origin/main');
if (behind !== '0' && behind !== '') fail(`main is ${behind} commit(s) behind origin — pull first`);

if (git('tag', '-l', tag) !== '') fail(`tag ${tag} already exists locally`);
if (git('ls-remote', '--tags', 'origin', tag) !== '') fail(`tag ${tag} already exists on origin`);

const ahead = git('rev-list', '--count', 'origin/main..HEAD');
console.log(`  branch main, clean, ${ahead} unpushed commit(s) — they go out with this release`);

// --- preflight: does it actually work --------------------------------------

step('Linting');
run('npm', ['run', 'lint']);

step('Type-checking');
run('npm', ['run', 'type-check']);

if (skipSmoke) {
  console.log('\n  smoke test SKIPPED (--skip-smoke) — nothing has confirmed the game still renders');
} else {
  step('Smoke test');
  // The one check CI does not repeat: it needs a display, and it is the only
  // thing here that boots the game rather than inspecting the source.
  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY && process.platform === 'linux') {
    fail('no display — run under `xvfb-run`, or pass --skip-smoke if you have verified it another way');
  }
  run('npm', ['run', 'smoke']);
}

// --- do it ------------------------------------------------------------------

if (dryRun) {
  console.log(`\nrelease: dry run complete. Would now run:`);
  console.log(`  npm version ${version} -m 'chore: release v%s'`);
  console.log(`  git push --follow-tags\n`);
  process.exit(0);
}

step(`Bumping to ${version} and tagging`);
run('npm', ['version', version, '-m', 'chore: release v%s']);

step('Pushing');
run('git', ['push', '--follow-tags']);

const repository = git('remote', 'get-url', 'origin')
  .replace(/^git@github\.com:/, 'https://github.com/')
  .replace(/\.git$/, '');

console.log(`\nrelease: ${tag} pushed. The release workflow is building three operating systems:`);
console.log(`  ${repository}/actions`);
console.log(`  ${repository}/releases/tag/${tag}\n`);
