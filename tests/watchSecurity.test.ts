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
  unsubscribeToken: `token-${id}`,
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

  it("requires the signed email token and pauses only the referenced watch", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "grantpilot-unsubscribe-"));
    const repository = new GrantRepository(resolve(directory, "state.json"));
    await repository.saveWatch(watch("watch-email", "owner-email"));
    const server = createHttpApp(repository).listen(0, "127.0.0.1");
    await new Promise<void>((resolvePromise) => server.once("listening", resolvePromise));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No test listener.");
      const base = `http://127.0.0.1:${address.port}/watches/unsubscribe?watchId=watch-email`;

      const invalid = await fetch(`${base}&token=wrong`);
      expect(invalid.status).toBe(404);
      expect(repository.listWatches()[0]?.status).toBe("active");

      const confirmation = await fetch(`${base}&token=token-watch-email`);
      expect(confirmation.status).toBe(200);
      expect(await confirmation.text()).toContain("Cancel these updates");
      expect(repository.listWatches()[0]?.status).toBe("active");

      const cancelled = await fetch(`${base}&token=token-watch-email`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "List-Unsubscribe=One-Click",
      });
      expect(cancelled.status).toBe(200);
      expect(await cancelled.text()).toContain("Updates cancelled");
      expect(repository.listWatches()[0]?.status).toBe("paused");
    } finally {
      await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
    }
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
