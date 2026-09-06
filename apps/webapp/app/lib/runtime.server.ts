/**
 * Which process are we? Not which queue is configured — which runtime is
 * actually executing this code right now.
 *
 * `isTriggerDeployment()` in `~/lib/queue-adapter.server` answers a
 * different question ("is QUEUE_PROVIDER=trigger"), and it is true in the
 * webapp process too. Anything that depends on process-local resources —
 * Redis being the one that bites — needs THIS check instead.
 *
 * `RUNNING_IN_TRIGGER` is set by the trigger.dev runtime (see
 * `trigger.config.ts`) and is never set in the webapp server or in a
 * BullMQ worker, both of which share the app's Redis. A trigger.dev
 * worker runs in a separate runtime with its OWN Redis, so a publish
 * from there lands on a bus nobody is listening to.
 */
export function isRunningInTrigger(): boolean {
  const flag = process.env.RUNNING_IN_TRIGGER;
  return flag === "1" || flag === "true";
}
