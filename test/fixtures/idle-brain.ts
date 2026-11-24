// B-118: the worker-link fixture's brain. The worker-link tests use no model, and a real brain process is a third of
// each fixture's start-up on a loaded Windows runner. It says READY, refuses every request and exits on disconnect.
process.on('message', (value: unknown) => {
  const id = (value as { id?: unknown })?.id;
  if (typeof id === 'string')
    process.send?.({ jsonrpc: '2.0', id, error: { code: -32601, message: 'No model in the worker-link fixture.' } });
});
process.on('disconnect', () => {
  process.exitCode = 0;
});
process.send?.({ nerv: 'ready' });
