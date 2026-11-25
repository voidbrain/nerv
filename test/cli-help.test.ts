import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatCommandHelp, formatHelp, HELP_GROUPS } from '../src/cli-help.ts';

/** Every top-level command the two dispatchers handle, read from their source. */
function dispatchedCommands(): string[] {
  const cli = readFileSync(new URL('../src/cli.ts', import.meta.url), 'utf8');
  const cmds = readFileSync(new URL('../src/cli-commands.ts', import.meta.url), 'utf8');
  const found = new Set<string>();
  for (const src of [cli, cmds]) for (const m of src.matchAll(/command === '([a-z0-9-]+)'/g)) found.add(m[1]!);
  for (const m of cli.matchAll(/^ {6}case '([a-z0-9-]+)':/gm)) found.add(m[1]!);
  for (const m of cli.matchAll(/\['([a-z0-9-]+)', '([a-z0-9-]+)', '([a-z0-9-]+)'\]\.includes\(command/g))
    [m[1], m[2], m[3]].forEach((c) => found.add(c!));
  found.delete('help');
  return [...found].sort();
}

const listed = () => HELP_GROUPS.flatMap((g) => g.commands.map((c) => c.name));

test('help lists every command the CLI dispatches, once', () => {
  const names = listed();
  assert.deepEqual(
    names.filter((n, i) => names.indexOf(n) !== i),
    [],
    'duplicates',
  );
  const missing = dispatchedCommands().filter((c) => !names.includes(c));
  assert.deepEqual(missing, [], 'commands missing from help');
  const unknown = names.filter((n) => !dispatchedCommands().includes(n));
  assert.deepEqual(unknown, [], 'help lists commands the CLI does not handle');
});

test('help groups commands by theme and sorts them alphabetically within each group', () => {
  const out = formatHelp(100);
  for (const group of HELP_GROUPS) {
    assert.ok(out.includes(`\n${group.title}\n`), group.title);
    const order = group.commands.map((c) => c.name);
    const positions = order.map((n) => out.indexOf(`\n  ${n} `));
    assert.ok(
      positions.every((p) => p > 0),
      `${group.title} renders every command`,
    );
    const rendered = [...order].sort((a, b) => out.indexOf(`\n  ${a} `) - out.indexOf(`\n  ${b} `));
    assert.deepEqual(rendered, [...order].sort(), `${group.title} is alphabetical`);
  }
});

test('help keeps lines within the width and aligns descriptions', () => {
  const out = formatHelp(100);
  for (const line of out.split('\n')) assert.ok(line.length <= 100, line);
  const starts = out
    .split('\n')
    .filter((l) => /^ {2}\S.* {2,}\S/.test(l))
    .map((l) => l.search(/ {2,}\S/) + l.slice(l.search(/ {2,}\S/)).search(/\S/));
  assert.equal(new Set(starts).size, 1, 'descriptions start in one column');
});

test('help for one command shows its full usage; an unknown command says so', () => {
  assert.match(formatCommandHelp('batteries') ?? '', /batteries import <export\.json>/);
  assert.match(formatCommandHelp('nodes') ?? '', /lifecycle-inspect/);
  assert.equal(formatCommandHelp('no-such-command'), undefined);
});
