import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GrantRepository } from "../src/repositories/grantRepository.js";
import { createHttpApp } from "../src/server.js";
import type { GrantWatch } from "../src/domain/types.js";

const originalAdminToken = process.env.ADMIN_WATCH_TOKEN;
afterEach(() => {
  if (originalAdminToken === undefined) delete process.env.ADMIN_WATCH_TOKEN;
  else process.env.ADMIN_WATCH_TOKEN = originalAdminToken;
});

const watch = (id: string, ownerKey: string): GrantWatch => ({
  id,
  ownerKey,
  queryId: "query",
  email: `${id}@example.org`,
  matchQuality: "worth-reviewing",
  minimumScore: 60,
  frequency: "daily",
  scope: "search",
  deadlineLeadDays: 14,
  notificationTypes: ["new-match"],
  status: "active",
  createdAt: new Date().toISOString(),
  nextCheckAt: new Date().toISOString(),
});

describe("watch security", () => {
  it("fails closed when the admin watch token is not configured", async () => {
    delete process.env.ADMIN_WATCH_TOKEN;
    const server = createHttpApp().listen(0, "127.0.0.1");
    await new Promise<void>((resolvePromise) => server.once("listening", resolvePromise));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test listener.");
    const response = await fetch(`http://127.0.0.1:${address.port}/admin/run-watches`, {
      method: "POST",
    });
    expect(response.status).toBe(503);
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
  });

  it("lists and deletes watches only for the matching owner", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "grantpilot-watch-"));
    const repository = new GrantRepository(resolve(directory, "state.json"));
    await repository.saveWatch(watch("watch-a", "owner-a"));
    await repository.saveWatch(watch("watch-b", "owner-b"));

    expect(repository.listWatchesForOwner("owner-a").map((item) => item.id)).toEqual(["watch-a"]);
    expect(await repository.deleteWatch("watch-b", "owner-a")).toBe(false);
    expect(repository.getWatchForOwner("watch-b", "owner-b")?.id).toBe("watch-b");
    expect(await repository.deleteWatch("watch-b", "owner-b")).toBe(true);
  });

  it("allows only one cross-process watch-run lease holder", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "grantpilot-lease-"));
    const repository = new GrantRepository(resolve(directory, "state.json"));
    expect(await repository.acquireWatchRunLease("runner-a", 60_000)).toBe(true);
    expect(await repository.acquireWatchRunLease("runner-b", 60_000)).toBe(false);
    expect(await repository.releaseWatchRunLease("runner-b")).toBe(false);
    expect(await repository.releaseWatchRunLease("runner-a")).toBe(true);
    expect(await repository.acquireWatchRunLease("runner-b", 60_000)).toBe(true);
    await repository.releaseWatchRunLease("runner-b");
  });
});
