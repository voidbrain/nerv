#!/usr/bin/env node
// F-125-T02: publish the built backlog views on backlog-views with this week's recap, as a local
// `npm run work:build` then `node tools/backlog-recap.mjs` writes them. The template's `work-items publish` renders the
// ledger with an empty recap block (the recap is NERV's own tool), so NERV's forked .github/workflows/backlog-views.yml
// runs this instead. It is the same publishViews (fast-forward of refs/heads/backlog-views only, never forced); the one
// difference is that the recap is written into docs/BACKLOG.md after the ledger is rendered and before it is hashed.
import { spawnSync } from 'node:child_process';
import { publishViews, settings, VIEWS_BRANCH } from './work-items.mjs';
import { fillRecap } from './backlog-recap.mjs';

const root = process.cwd();
const config = settings(root);
if (!config) throw Error('Work items not adopted');
let filled = false;
const git = (args, env = {}) => {
  if (args[0] === 'hash-object') {
    fillRecap();
    filled = true;
  }
  // Never push a ledger without its recap: a template change that hashes the ledger another way stops here.
  if (args[0] === 'push' && !filled)
    throw Error('publish-views: the ledger was not hashed through hash-object, so the recap is missing; update this tool');
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env, ...env } });
  if (r.status !== 0) throw Error(`git ${args[0]} failed: ${(r.stderr || r.stdout || '').trim()}`);
  return r.stdout.trim();
};
const done = publishViews(root, config, { git });
console.log(
  done.published
    ? `Published the views of ${done.source} on ${VIEWS_BRANCH} (${done.commit}), with the recap.`
    : done.reason
      ? `Not published: ${done.reason}.`
      : `The views of ${done.source} are already on ${VIEWS_BRANCH}: nothing to publish.`,
);
