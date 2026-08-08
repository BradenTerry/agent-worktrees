/**
 * The order the agents view groups its rows in, isolated from the VS Code API so
 * it can be unit-tested and read by both ends without either importing the other.
 *
 * The value is a user setting (`agentWorktrees.agentStatusOrder`), which means it
 * arrives from a JSON file anybody can edit: a partial list, a duplicate, a
 * status that does not exist, or something that is not a list at all. None of
 * those may be able to hide an agent, so this normalizes rather than validates -
 * every status appears exactly once in the result, whatever went in.
 */

import type { AgentStatus } from "./worktreeData";

/** Waiting first: the agent that needs you is the reason to open the view. */
export const DEFAULT_AGENT_STATUS_ORDER: AgentStatus[] = [
  "waiting",
  "active",
  "idle",
];

const KNOWN: AgentStatus[] = ["waiting", "active", "idle"];

function isStatus(v: unknown): v is AgentStatus {
  return typeof v === "string" && (KNOWN as string[]).includes(v);
}

/**
 * A stored order made safe to render with: known statuses in the order given,
 * each kept only the first time it appears, then any status the value left out
 * appended in the default order. A value that contributes nothing usable (not an
 * array, empty, all unknown) therefore comes back as the default.
 */
export function normalizeAgentStatusOrder(value: unknown): AgentStatus[] {
  const out: AgentStatus[] = [];
  if (Array.isArray(value)) {
    for (const v of value) {
      if (isStatus(v) && !out.includes(v)) out.push(v);
    }
  }
  for (const s of DEFAULT_AGENT_STATUS_ORDER) {
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

/**
 * Move one status one place up (-1) or down (+1), returning a new order. Out of
 * range moves are no-ops, so the ends of the list need no special casing at the
 * call site.
 */
export function moveAgentStatus(
  order: AgentStatus[],
  status: AgentStatus,
  delta: number
): AgentStatus[] {
  const list = normalizeAgentStatusOrder(order);
  const from = list.indexOf(status);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= list.length) return list;
  list.splice(to, 0, list.splice(from, 1)[0]);
  return list;
}
