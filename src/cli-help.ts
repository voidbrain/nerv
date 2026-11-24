/**
 * `nerv help`: commands grouped by theme, alphabetical within each group, descriptions in one column.
 * `nerv help COMMAND` prints that command's full usage. A test keeps this list in step with the dispatchers.
 */

export interface HelpCommand {
  name: string;
  /** Short argument summary shown in the overview. */
  args?: string;
  about: string;
  /** Full usage lines for `nerv help COMMAND`; defaults to `name args`. */
  usage?: string[];
}

export interface HelpGroup {
  title: string;
  commands: HelpCommand[];
}

export const HELP_GROUPS: HelpGroup[] = [
  {
    title: 'Talk to NERV',
    commands: [
      { name: 'ask', args: '[--cloud] "text"', about: 'One question to the model; local unless --cloud' },
      { name: 'chat', args: '"text"', about: 'Chat as you would in Telegram or the dashboard' },
      { name: 'act', args: '"request" TOOL [JSON]', about: 'Propose one tool action through the gate' },
      { name: 'brief', about: 'The morning brief, now' },
      { name: 'chronicle', args: '[DAYS] [--eva]', about: 'What happened on this base' },
    ],
  },
  {
    title: 'Reminders and inbox',
    commands: [
      { name: 'remind', args: '"title" "ISO time+zone"', about: 'Add a reminder' },
      { name: 'list', about: 'Pending reminders' },
      { name: 'cancel', args: 'ID', about: 'Cancel a pending reminder' },
      { name: 'inbox', about: 'Delivered messages' },
      { name: 'tick', about: 'Deliver due reminders now' },
      {
        name: 'resume-intent',
        args: 'list|create|cancel|tick',
        about: 'Work to pick up again later',
        usage: ['resume-intent list [status] | create <intent.json> | cancel <id> [reason] | tick'],
      },
      {
        name: 'session-limit',
        args: 'list|record',
        about: 'Resume a coding session after its limit resets',
        usage: ['session-limit list | record SESSION REPO BRANCH "ISO reset time+zone" [--prompt TEXT]'],
      },
    ],
  },
  {
    title: 'Approvals and actions',
    commands: [
      { name: 'approvals', about: 'Actions waiting for you' },
      { name: 'approve', args: 'ID', about: 'Approve one' },
      { name: 'reject', args: 'ID', about: 'Reject one' },
      { name: 'events', args: 'SORTIE_ID', about: "A sortie's event history" },
      { name: 'spear', args: 'SORTIE_ID [reason]', about: 'Stop a sortie (Spear of Longinus)' },
      {
        name: 'persona',
        args: 'hitl list|decide · explain',
        about: 'Persona decisions waiting for you',
        usage: ['persona hitl list | persona hitl decide <approvalId> approve|reject | persona explain <ref>'],
      },
    ],
  },
  {
    title: 'Memory and learning',
    commands: [
      {
        name: 'memory',
        args: 'list|add|edit|forget|history|episodes',
        about: 'Confirmed facts (Lilith)',
        usage: ['memory list | add "fact" | edit ID "fact" | forget ID | history ID | episodes'],
      },
      { name: 'instrumentality', about: 'Run fact consolidation; proposals wait for you' },
      {
        name: 'skills',
        args: 'list|inspect|stage|evaluate|promote|…',
        about: 'Skill packages and their versions',
        usage: [
          'skills list | inspect <id> <version> | stage <package.json>',
          'skills evaluate <id> <version> <suite.json> <model>',
          'skills promote <id> <version> --owner-approved [--model <model>]',
          'skills reconcile-model <new-model> <suites.json> --owner-approved',
          'skills rollback <id> --owner-approved | retire <id> --owner-approved',
        ],
      },
      {
        name: 'voice',
        args: 'parse|eval',
        about: 'Voice transcript parsing',
        usage: ['voice parse <transcript> [it|en] | voice eval <corpus.json>'],
      },
    ],
  },
  {
    title: 'Models, pilots and tools',
    commands: [
      {
        name: 'models',
        args: '[set|cloud|key]',
        about: 'Which model plays each role',
        usage: [
          'models | models set misato MODEL | models set misato cloud [MODEL]',
          'models set casper MODEL | models set consultant MODEL|off',
          'models cloud on|off [MODEL] | models key',
        ],
      },
      {
        name: 'pilots',
        args: '[generic|add|set|pin|rename|retire|…]',
        about: 'Local advisers and their models',
        usage: [
          'pilots | pilots generic MODEL|off',
          'pilots add ID --name NAME --domain "WHAT IT KNOWS" --keywords a,b,c --model MODEL [--role ROLE] …',
          'pilots set|pin|unpin|retire|restore ID … | pilots rename ID NAME',
        ],
      },
      {
        name: 'tools',
        args: '[add|remove|grant|revoke]',
        about: 'MCP servers and owner grants',
        usage: [
          'tools | tools add ID COMMAND [ARGS…] | tools remove ID',
          'tools grant SERVER/TOOL [--effect read] [--eva 00|01|02|03] | tools revoke SERVER/TOOL',
        ],
      },
      { name: 'seats', args: '[check | key SEAT-ID]', about: 'MAGI seats and their keys' },
      {
        name: 'placement',
        args: 'plan PROBE.json | run PROBE.json --execute | report EVIDENCE.json',
        about: 'Plan or run a bounded P2–P4 placement probe, or report on placement evidence',
      },
      {
        name: 'engines',
        args: 'ACTION --spec FILE',
        about: 'Local inference engines',
        usage: ['engines <status|start|stop|install|uninstall|reconcile> --spec FILE'],
      },
      { name: 'bom', about: 'Runtime bill of materials: version, models found' },
      { name: 'circuits', args: 'list | rearm CHANNEL', about: 'Channel circuit breakers' },
    ],
  },
  {
    title: 'Isolated execution and automation',
    commands: [
      {
        name: 'eva',
        args: 'classes|limits|admit|jobs|…',
        about: 'EVA isolation classes and jobs',
        usage: [
          'eva classes | eva limits | eva job-user [<user> <folder> | off]',
          'eva admit <request.json> | eva run-tools-03 | eva jobs | eva reconcile <jobId> <confirmed>',
        ],
      },
      { name: 'coding-job', args: 'REPO JOB ALLOWLIST', about: 'Run a coding job on an allowed repository' },
      {
        name: 'harness-job',
        args: 'REPO JOB TEMPLATE TAG ALLOWLIST',
        about: 'Apply a pinned harness template tag as a coding job',
      },
      { name: 'headless-resume', args: 'TARGETS.json', about: 'Resume headless sessions' },
      { name: 'quarantine', args: 'fetch|report URL', about: 'Fetch untrusted content into quarantine' },
      {
        name: 'browser-click',
        args: 'CONTROL [--approved]',
        about: 'Click a named control on the allowed browser tab',
      },
      {
        name: 'desktop-click',
        args: 'APP CONTROL [--window=TITLE] [--approved]',
        about: 'Click a named desktop control (macOS)',
      },
      {
        name: 'app-workflow',
        args: 'PLAN.json [--approve=HASH] [--overwrite=PATH]',
        about: 'Show, then run, an open/save-as plan (macOS)',
      },
      { name: 'fpv-read-build', args: 'LINK', about: 'Read a diyfpv.com build into its local build note' },
      { name: 'desktop-record', args: 'ID HEADER.json', about: 'Record desktop input for a workflow' },
    ],
  },
  {
    title: 'FPV and making',
    commands: [
      {
        name: 'batteries',
        args: 'list|status|due|resistance|chat|import',
        about: 'FPV batteries: state, cycles, resistance',
        usage: [
          'batteries list | batteries status [--lang it|en] | batteries due [--lang it|en]',
          'batteries resistance <id> <v1,v2,...> | batteries chat <phrase>',
          'batteries import <export.json>',
        ],
      },
      {
        name: 'fleet',
        args: 'drones|parts|spares|import',
        about: 'Drones, parts and spares',
        usage: ['fleet drones | fleet parts <drone> | fleet spares [category]', 'fleet import <fleet.json>'],
      },
      { name: 'card-copy', args: 'MOUNT LABEL RULES.json', about: 'Copy files from a memory card by rules' },
      { name: 'slice', args: 'IN OUT PROFILE ALLOWLIST', about: 'Slice a model for the 3D printer' },
    ],
  },
  {
    title: 'Bases (Kaji line)',
    commands: [
      {
        name: 'kaji',
        args: 'enrol|revoke|main|relocate|drain|standby|promote|offer|seat|list|export|import',
        about: 'Enrolled bases',
        usage: [
          'kaji enrol BASE-ID "Name" PUBKEY|self ADDRESS | kaji revoke BASE-ID | kaji list',
          'kaji main [BASE-ID] | kaji offer [ACTION…|none] | kaji seat BASE-ID shadow|veto|off',
          'kaji export [FILE] | kaji import FILE --root FINGERPRINT',
          'kaji relocate BASE-ID [--revoke LOST-ID] | kaji drain [FILE] | kaji standby [BASE-ID]',
          'kaji promote [--drain-receipt FILE]',
        ],
      },
      {
        name: 'nodes',
        args: 'discover|inspect|plan|lifecycle-*|…',
        about: 'Find, set up and update bases',
        usage: [
          'nodes discover | inspect | plan | update-check | upgrade-rehearse --backup DIR',
          'nodes lifecycle-inspect --action install|update|start|stop|uninstall --out PLAN.json',
          'nodes lifecycle-apply --plan PLAN.json --confirm DIGEST | lifecycle-status --digest DIGEST',
          'nodes lifecycle-plan | lifecycle-recover | lifecycle-recovery-check | lifecycle-release',
          'nodes node-runtime-plan | node-runtime-activate | node-runtime-recover',
        ],
      },
      {
        name: 'workers',
        args: 'pending|history|held|result|…',
        about: 'Work sent to other bases',
        usage: [
          'workers pending | history | held | result ID | release ID',
          'workers cancel ID | cancel-outbox ID | retry-outbox ID | abandon-outbox ID',
        ],
      },
    ],
  },
  {
    title: 'Service and updates',
    commands: [
      { name: 'serve', about: 'Run NERV in the foreground' },
      { name: 'launch', about: 'Run NERV and open the dashboard' },
      {
        name: 'service',
        args: 'install|start|stop|status|uninstall|move [--to PATH] [--yes]',
        about: 'The background service; move runs it from its own install folder',
      },
      { name: 'reload', about: 'Make the running service re-read its configuration' },
      {
        name: 'update',
        args: '[--check]',
        about: 'Update the install folder to origin/main; --check only reports',
        usage: [
          'update --check (up to date, or behind origin/main by N commits; changes nothing)',
          'update (fetch into the install folder, stop, lifecycle update: backup, rehearsal, build, start, verify)',
        ],
      },
      { name: 'doctor', about: 'Check this installation' },
      {
        name: 'update-policy',
        args: 'on|off|status',
        about: 'Automatic updates',
        usage: ['update-policy <on|off|status> [--channel main] [--target BASE-ID]'],
      },
      {
        name: 'backup',
        args: 'keygen|status|decrypt|restore',
        about: 'Encrypted backups',
        usage: [
          'backup keygen --out PATH (a place off this machine, for example a USB stick)',
          'backup status | backup decrypt COPY --key PATH --out PATH',
          'backup restore COPY --key PATH --target DIR',
        ],
      },
    ],
  },
  {
    title: 'Setup, identity and access',
    commands: [
      {
        name: 'init',
        args: '[--base ID --name "Name"] [--fresh]',
        about: 'Set up NERV in this home',
        usage: ['init [--base ID --name "Name"] [--no-model-setup] [--fresh]'],
      },
      { name: 'base', args: '[ID "Name" | pubkey]', about: "This base's identity" },
      { name: 'key', args: 'init [--out PATH]', about: 'Create the root key' },
      { name: 'root-migration', args: 'plan|apply|status', about: 'Move to a replacement root key' },
      { name: 'credentials', args: 'rotate admin|telegram|cloud', about: 'Rotate a secret' },
      { name: 'telegram', args: 'token | link [CHAT_ID]', about: 'Connect the Telegram bot' },
      { name: 'native-init', about: 'Set up TLS for the native companion' },
      { name: 'pair', args: '[label]', about: 'Pair a native companion' },
      { name: 'clients', about: 'Paired companions' },
      { name: 'revoke', args: 'CLIENT_ID', about: 'Unpair a companion' },
      { name: 'sessions', args: 'revoke', about: 'Sign out every dashboard session' },
      { name: 'open', args: '[dashboard] [--phone]', about: 'Open the dashboard, or pair a phone' },
    ],
  },
];

const byName = (a: HelpCommand, b: HelpCommand) => a.name.localeCompare(b.name);

/** Wraps `text` to `width`, prefixing continuation lines with `indent` spaces. */
function wrap(text: string, width: number, indent: number): string[] {
  const lead = /^ */.exec(text)![0];
  const lines: string[] = [];
  let line = lead;
  for (const word of text.slice(lead.length).split(/ +/)) {
    if (line.trim() && line.length + 1 + word.length > width) {
      lines.push(line);
      line = ' '.repeat(indent) + word;
    } else line = line.trim() ? `${line} ${word}` : line + word;
  }
  if (line.trim()) lines.push(line);
  return lines;
}

/** The overview: groups in theme order, commands alphabetical, descriptions aligned in one column. */
export function formatHelp(width = 100): string {
  const left = (c: HelpCommand) => `  ${c.name}${c.args ? ` ${c.args}` : ''}`;
  const all = HELP_GROUPS.flatMap((g) => g.commands);
  const column = Math.min(Math.max(...all.map((c) => left(c).length)) + 2, 44);
  const out = ['NERV Agency', '', 'Usage: nerv COMMAND [ARGS]   ·   nerv help COMMAND for full usage'];
  for (const group of HELP_GROUPS) {
    out.push('', group.title);
    for (const c of [...group.commands].sort(byName)) {
      const head = left(c);
      const about = wrap(c.about, width - column, 0).map((l) => ' '.repeat(column) + l);
      if (head.length + 2 <= column) about[0] = head.padEnd(column) + about[0]!.slice(column);
      else out.push(...wrap(head, width, 4));
      out.push(...about);
    }
  }
  return out.join('\n');
}

/** Full usage for one command, or undefined when there is no such command. */
export function formatCommandHelp(name: string, width = 100): string | undefined {
  const c = HELP_GROUPS.flatMap((g) => g.commands).find((x) => x.name === name);
  if (!c) return undefined;
  const usage = c.usage ?? [`${c.name}${c.args ? ` ${c.args}` : ''}`];
  return [`nerv ${c.name}: ${c.about}`, '', ...usage.flatMap((u) => wrap(`  nerv ${u}`, width, 4))].join('\n');
}
