# F-123: NERV lists the Grover tools

Owner steps for [F-123](https://github.com/voidbrain/nerv/blob/backlog-views/docs/BACKLOG.md#f-123) (step F-123-T02). Run every command in a Terminal on the owner's Mac (NERV-01), with Grover's hub running on the Pi and published on the tailnet at `https://<pi>.<tailnet>.ts.net/mcp`. Replace `<pi>.<tailnet>` with the Pi's tailnet name (`tailscale status` on the Pi shows it). The [remote MCP guide](../guides/remote-mcp.md) explains each command.

## 1. The installed service has F-123-T01

```bash
git -C ~/.nerv-app merge-base --is-ancestor 4dae734e HEAD && echo included
```

Expected: `included`. Without it, run `nerv update` once, then step 1 again.

## 2. The hub answers from this Mac

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://<pi>.<tailnet>.ts.net/mcp
```

Expected: an HTTP status code (any, for example `200`, `400`, `405` or `406`: the hub answered). A connection or certificate error instead: the hub or the tailnet is the problem, not NERV; note the output.

## 3. Register the hub and list its tools

```bash
nerv tools add grover https://<pi>.<tailnet>.ts.net/mcp
nerv tools
```

Expected: a `grover` server with the Grover tools listed as `grover.<tool>`, each with `read-only` or `destructive` as the hub declares it, none granted yet.

## 4. Grant one read tool and ask in chat

Pick a read tool from step 3 (for example the alerts list, `grover_alerts`):

```bash
nerv tools grant grover/grover_alerts
nerv chat "ci sono allarmi Grover?"
```

Expected: the grant is `read` (Green); Misato answers from the tool (the open alerts, or that there are none) with no approval card.

## 5. An unreachable hub is reported

Stop the hub on the Pi (or take the Pi off the tailnet), then:

```bash
nerv tools
```

Expected: `grover` shows `could not list its tools:` with a reason naming the host. Start the hub again; `nerv tools` lists the tools once more.

Tell the agent the outcome of each step (or paste the output of steps 3 to 5); it records the evidence in F-123 and closes it.
