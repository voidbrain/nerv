#!/usr/bin/env node
// Safety rules always loaded; procedures loaded when needed (AGENTS, "Procedures: read before the task"). AGENTS.md
// holds every never and ask-first rule between <!-- safety:start --> and <!-- safety:end -->, and a trigger per
// procedure; the procedures live in their documents. This check fails when:
//   - AGENTS.md has no single safety block, or the block lacks its "Asks first:" or "Never:" rules;
//   - a procedure document states an ask-first or never rule (a sentence opening with the AGENTS labels "Asks first:"
//     or "Never:", or one saying the agent asks first) that is neither, as a whole sentence, in the safety block nor
//     cites it ("(AGENTS, …)" or "AGENTS, \"…\""). A procedure's own domain rules ("Never duplicate an ID") are
//     procedure: a rule about what the agent may do without asking is written with the labels, in AGENTS;
//   - a link from AGENTS.md to a local document does not resolve (a trigger pointing nowhere loads nothing).
// It warns when AGENTS.md is longer than rules.maxLines (default 200): move procedure detail out, never a rule.
// Settings: .harness.json "rules": { agents?: "AGENTS.md", procedures?: ["docs/BACKLOG-RULES.md", "docs/backlog/*.md",
// "docs/agents/*.md"],
// maxLines?: 200 }.
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

export const START = '<!-- safety:start -->',
  END = '<!-- safety:end -->';
const norm = (s) => s.replace(/[`*_]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
// the sentences of a document's prose (code blocks and inline code left out), with their line numbers
function sentences(text) {
  const out = [];
  let fence = false;
  text.split('\n').forEach((line, i) => {
    if (/^\s*```/.test(line)) {
      fence = !fence;
      return;
    }
    if (fence) return;
    for (const s of line.replace(/`[^`\n]*`/g, '').split(/(?<=[.!?])\s+(?=[A-Z*])/))
      if (s.trim()) out.push({ line: i + 1, text: s.trim() });
  });
  return out;
}
// an ask-first or never rule about what the agent may do, as AGENTS words them
// (quoted text, such as a section title, names a rule; it does not state one)
export const isAuthorityRule = (s) => {
  const text = s.text.replace(/"[^"]*"|“[^”]*”/g, '');
  return (
    /^\s*(?:[-*]\s+)?\**(?:Asks? first|Never)\**:/i.test(text) ||
    /\b(?:agents?|it|you)\s+(?:must\s+)?asks?\s+(?:the\s+(?:user|owner)\s+)?(?:first|before)\b/i.test(text) ||
    /\bask(?:s)?\s+(?:the\s+(?:user|owner)\s+)?first\b/i.test(text)
  );
};

const glob = (root, pattern) => {
  if (!pattern.includes('*')) return existsSync(join(root, pattern)) ? [pattern] : [];
  const dir = dirname(pattern),
    re = new RegExp(
      `^${pattern
        .slice(dir === '.' && !pattern.startsWith('./') ? 0 : dir.length + 1)
        .replace(/[.]/g, '\\.')
        .replace(/\*/g, '[^/]*')}$`,
    );
  return existsSync(join(root, dir))
    ? readdirSync(join(root, dir))
        .filter((f) => re.test(f))
        .map((f) => (dir === '.' ? f : `${dir}/${f}`))
        .sort()
    : [];
};

export function checkRules(root) {
  let stamp = {};
  try {
    stamp = JSON.parse(readFileSync(join(root, '.harness.json'), 'utf8'));
  } catch {
    /* no stamp: defaults */
  }
  const cfg = stamp.rules ?? {},
    agentsPath = cfg.agents ?? 'AGENTS.md',
    maxLines = cfg.maxLines ?? 200;
  const problems = [],
    warnings = [];
  if (!existsSync(join(root, agentsPath))) return { problems: [`${agentsPath} is missing`], warnings, procedures: [] };
  const agents = readFileSync(join(root, agentsPath), 'utf8');
  const starts = agents.split(START).length - 1,
    ends = agents.split(END).length - 1;
  let block = '';
  if (starts !== 1 || ends !== 1 || agents.indexOf(END) < agents.indexOf(START))
    problems.push(`${agentsPath}: needs one ${START} … ${END} block holding the never and ask-first rules`);
  else {
    block = agents.slice(agents.indexOf(START), agents.indexOf(END));
    for (const label of ['Asks first:', 'Never:'])
      if (!block.includes(label)) problems.push(`${agentsPath}: the safety block has no "${label}" rules`);
  }
  // the block's rules as whole sentences and list items, so a fragment of one never counts as the rule
  const safe = new Set(
    sentences(block)
      .flatMap((s) => [s.text, ...s.text.split(/;\s*/)])
      .map((x) =>
        norm(x)
          .replace(/^[-*]\s+/, '')
          .replace(/^(?:asks? first|never):\s*/, ''),
      ),
  );
  const cites = (text) => /\(AGENTS\b|\bAGENTS(?:\.md)?,\s*["“]/.test(text);
  const procedures = [
    ...new Set(
      (cfg.procedures ?? ['docs/BACKLOG-RULES.md', 'docs/backlog/*.md', 'docs/agents/*.md']).flatMap((p) =>
        glob(root, p),
      ),
    ),
  ].filter((p) => p !== agentsPath);
  for (const file of procedures) {
    for (const s of sentences(readFileSync(join(root, file), 'utf8'))) {
      if (!isAuthorityRule(s) || cites(s.text)) continue;
      const rule = norm(s.text)
        .replace(/^[-*]\s+/, '')
        .replace(/^(?:asks? first|never):\s*/, '');
      if (safe.has(rule)) continue;
      problems.push(
        `${file}:${s.line}: an ask-first or never rule only a procedure holds: "${s.text.slice(0, 100)}". Put it in the ${agentsPath} safety block (the procedure may cite it: "AGENTS, …")`,
      );
    }
  }
  const prose = agents.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  for (const [, url] of prose.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g))
    if (!/^[a-z]+:/.test(url) && !existsSync(normalize(join(root, dirname(agentsPath), url))))
      problems.push(`${agentsPath}: the link ${url} leads nowhere`);
  const lines = agents.split('\n').length;
  if (lines > maxLines)
    warnings.push(
      `${agentsPath} has ${lines} lines (rules.maxLines ${maxLines}): move procedure detail to its document and leave a trigger; never move a rule`,
    );
  return { problems, warnings, procedures };
}

// run as a script (also through a symlinked folder), not imported
const direct = (() => {
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1] ?? '');
  } catch {
    return false;
  }
})();
if (direct) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const { problems, warnings, procedures } = checkRules(root);
  for (const w of warnings) console.log(process.argv.includes('--github') ? `::warning title=Rules::${w}` : `! ${w}`);
  if (problems.length) {
    console.error(problems.join('\n'));
    console.error(`${problems.length} rule placement problem(s); see AGENTS.md, "Procedures: read before the task".`);
    process.exit(1);
  }
  console.log(
    `Rules: the safety block holds the never and ask-first rules; ${procedures.length} procedure document(s) add none of their own; every AGENTS link resolves.`,
  );
}
