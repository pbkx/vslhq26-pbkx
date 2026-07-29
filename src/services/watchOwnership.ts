import { createHash } from "node:crypto";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
  ServerNotification,
  ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";

type ToolRequestExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex").slice(0, 24);

const claim = (extra: Record<string, unknown> | undefined, names: string[]) => {
  for (const name of names) {
    const value = extra?.[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
};

/**
 * Watch ownership uses validated authentication claims when the MCP server is
 * protected by OAuth. The current no-auth demo falls back to the SDK-provided
 * MCP session ID, which prevents one live Copilot session from listing or
 * deleting another session's watches without pretending to provide tenant-wide
 * identity.
 */
export function watchOwnerKey(extra: ToolRequestExtra) {
  if (extra.authInfo) {
    const tenant = claim(extra.authInfo.extra, ["tid", "tenantId", "tenant_id"]);
    const subject = claim(extra.authInfo.extra, ["oid", "sub", "userId", "user_id"]);
    const principal = [extra.authInfo.clientId, tenant, subject].filter(Boolean).join(":");
    return `auth:${digest(principal)}`;
  }
  if (extra.sessionId) return `session:${digest(extra.sessionId)}`;
  throw new Error("A stable MCP session or authenticated principal is required to manage watches.");
}

export function maskWatchEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "hidden";
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(2, local.length - visible.length))}@${domain}`;
}
