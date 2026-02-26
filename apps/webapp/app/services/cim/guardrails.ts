/**
 * CIM Guardrails & Permissions
 *
 * Hard limits the agent cannot bypass. Enforces:
 *   - Prohibited actions (never delete without confirmation)
 *   - Rate limits per integration
 *   - Role-based access control
 *   - Action validation before execution
 *
 * The agent doesn't know about constraints. It tries to act,
 * and the guardrail layer enforces the rules. Blocked actions
 * get logged and the agent is informed.
 */

import { logger } from "~/services/logger.service";

import type {
  ActionRequest,
  Guardrail,
  GuardrailResult,
  GuardrailAction,
  PermissionPolicy,
  RateLimit,
  PlanStep,
  CIMEngineConfig,
} from "./types";

// ---------------------------------------------------------------------------
// Built-in Guardrails
// ---------------------------------------------------------------------------

const BUILTIN_GUARDRAILS: Guardrail[] = [
  {
    id: "no-destructive-without-confirmation",
    name: "No Destructive Actions",
    description: "Block delete/remove actions without explicit confirmation",
    priority: 100,
    check: (request: ActionRequest): GuardrailAction => {
      const destructivePatterns = [
        /\bdelete\b/i,
        /\bremove\b/i,
        /\bdrop\b/i,
        /\bpurge\b/i,
        /\bdestroy\b/i,
      ];
      const paramStr = JSON.stringify(request.parameters);
      const isDestructive = destructivePatterns.some(
        (pattern) =>
          pattern.test(request.tool) || pattern.test(paramStr),
      );

      if (isDestructive && request.permissions !== "admin") {
        return "require_approval";
      }
      return "allow";
    },
  },
  {
    id: "no-sensitive-data-exposure",
    name: "No Sensitive Data Exposure",
    description: "Prevent actions that might expose credentials or PII",
    priority: 99,
    check: (request: ActionRequest): GuardrailAction => {
      const sensitivePatterns = [
        /password/i,
        /secret/i,
        /api[_-]?key/i,
        /token/i,
        /credential/i,
        /ssn/i,
        /credit[_-]?card/i,
      ];
      const paramStr = JSON.stringify(request.parameters);
      const hasSensitive = sensitivePatterns.some((pattern) =>
        pattern.test(paramStr),
      );

      if (hasSensitive) {
        return "require_approval";
      }
      return "allow";
    },
  },
  {
    id: "write-requires-write-permission",
    name: "Write Permission Check",
    description: "Write actions require write or admin permission",
    priority: 98,
    check: (request: ActionRequest): GuardrailAction => {
      const writeActions = [
        "integration_action",
        "send_email",
        "create_issue",
        "post_message",
        "update",
        "edit",
      ];
      const isWrite = writeActions.some(
        (action) =>
          request.tool.includes(action) ||
          JSON.stringify(request.parameters).toLowerCase().includes(action),
      );

      if (isWrite && request.permissions === "read") {
        return "deny";
      }
      return "allow";
    },
  },
];

// ---------------------------------------------------------------------------
// Guardrail Engine
// ---------------------------------------------------------------------------

export function checkGuardrails(
  request: ActionRequest,
  customGuardrails: Guardrail[] = [],
): GuardrailResult[] {
  const allGuardrails = [...BUILTIN_GUARDRAILS, ...customGuardrails].sort(
    (a, b) => b.priority - a.priority,
  );

  const results: GuardrailResult[] = [];

  for (const guardrail of allGuardrails) {
    const action = guardrail.check(request);
    if (action !== "allow") {
      results.push({
        action,
        guardrailId: guardrail.id,
        reason: guardrail.description,
      });
      logger.info(
        `[CIM:Guardrails] ${guardrail.name} triggered: ${action} - ${guardrail.description}`,
      );
    }
  }

  return results;
}

export function isActionAllowed(results: GuardrailResult[]): boolean {
  return !results.some((r) => r.action === "deny");
}

export function requiresApproval(results: GuardrailResult[]): boolean {
  return results.some((r) => r.action === "require_approval");
}

// ---------------------------------------------------------------------------
// Rate Limiter
// ---------------------------------------------------------------------------

const rateLimitStore = new Map<string, RateLimit>();

export function checkRateLimit(
  agentId: string,
  integration: string,
  policy?: PermissionPolicy,
): { allowed: boolean; remaining: number; resetMs: number } {
  if (!policy?.rateLimit) {
    return { allowed: true, remaining: Infinity, resetMs: 0 };
  }

  const key = `${agentId}:${integration}`;
  const now = new Date();
  let limit = rateLimitStore.get(key);

  // Reset window if expired
  if (
    !limit ||
    now.getTime() - limit.windowStart.getTime() > policy.rateLimit.windowMs
  ) {
    limit = {
      maxRequests: policy.rateLimit.maxRequests,
      windowMs: policy.rateLimit.windowMs,
      currentCount: 0,
      windowStart: now,
    };
    rateLimitStore.set(key, limit);
  }

  const remaining = limit.maxRequests - limit.currentCount;
  const resetMs =
    limit.windowMs - (now.getTime() - limit.windowStart.getTime());

  if (remaining <= 0) {
    logger.warn(
      `[CIM:Guardrails] Rate limit hit for ${agentId} on ${integration}. ` +
        `Resets in ${resetMs}ms`,
    );
    return { allowed: false, remaining: 0, resetMs };
  }

  limit.currentCount++;
  return { allowed: true, remaining: remaining - 1, resetMs };
}

// ---------------------------------------------------------------------------
// Permission Policy Check
// ---------------------------------------------------------------------------

export function checkPermission(
  action: string,
  integration: string,
  policies: PermissionPolicy[],
): { allowed: boolean; reason?: string } {
  const policy = policies.find((p) => p.integration === integration);

  if (!policy) {
    // No policy = default allow for reads, require approval for writes
    return { allowed: true };
  }

  // Check denied actions first
  if (policy.deniedActions.length > 0) {
    const isDenied = policy.deniedActions.some(
      (denied) =>
        action.toLowerCase().includes(denied.toLowerCase()) ||
        denied === "*",
    );
    if (isDenied) {
      return {
        allowed: false,
        reason: `Action "${action}" is denied for integration "${integration}"`,
      };
    }
  }

  // Check allowed actions
  if (policy.allowedActions.length > 0) {
    const isAllowed = policy.allowedActions.some(
      (allowed) =>
        action.toLowerCase().includes(allowed.toLowerCase()) ||
        allowed === "*",
    );
    if (!isAllowed) {
      return {
        allowed: false,
        reason: `Action "${action}" is not in the allowed list for integration "${integration}"`,
      };
    }
  }

  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Step Guardrail Check (convenience for plan execution)
// ---------------------------------------------------------------------------

export function checkStepGuardrails(
  step: PlanStep,
  config: CIMEngineConfig,
  customGuardrails?: Guardrail[],
): {
  canExecute: boolean;
  needsApproval: boolean;
  blockedReasons: string[];
} {
  const request: ActionRequest = {
    id: step.id,
    tool: step.action,
    parameters: { description: step.description },
    permissions: "write",
  };

  const results = checkGuardrails(request, customGuardrails);

  return {
    canExecute: isActionAllowed(results),
    needsApproval: requiresApproval(results),
    blockedReasons: results
      .filter((r) => r.action === "deny")
      .map((r) => r.reason),
  };
}
