import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { GrantResult, GrantWatch, SearchOutput } from "../domain/types.js";

export class GrantRepository {
  private searches = new Map<string, SearchOutput>();
  private grants = new Map<string, GrantResult>();
  private watches = new Map<string, GrantWatch>();
  private path: string;
  private persistQueue: Promise<void> = Promise.resolve();

  constructor(path = resolve(process.env.GRANTPILOT_STORE_PATH ?? "cache/grants/state.json")) {
    this.path = path;
  }

  async hydrate() {
    try {
      const data = JSON.parse(await readFile(this.path, "utf8"));
      for (const search of data.searches ?? []) {
        this.searches.set(search.queryId, search);
        search.grants.forEach((grant: GrantResult) => this.grants.set(grant.opportunity.id, grant));
      }
      for (const watch of data.watches ?? []) this.watches.set(watch.id, watch);
    } catch {
      // A missing local state file is normal on the first run.
    }
  }

  saveSearch(search: SearchOutput) {
    this.searches.set(search.queryId, search);
    search.grants.forEach((grant) => this.grants.set(grant.opportunity.id, grant));
    void this.enqueuePersist().catch(() => undefined);
    return search;
  }

  async flush() {
    await this.persistQueue;
  }

  getSearch(id: string) {
    const value = this.searches.get(id);
    if (!value) throw new Error(`Unknown or expired query: ${id}`);
    return value;
  }

  getGrant(id: string) {
    const value = this.grants.get(id);
    if (!value) throw new Error(`Unknown grant: ${id}`);
    return value;
  }

  async saveWatch(watch: GrantWatch) {
    this.watches.set(watch.id, watch);
    await this.enqueuePersist();
    return watch;
  }

  listWatches() {
    return [...this.watches.values()];
  }

  listWatchesForOwner(ownerKey: string) {
    return this.listWatches().filter((watch) => watch.ownerKey === ownerKey);
  }

  getWatchForOwner(id: string, ownerKey: string) {
    const watch = this.watches.get(id);
    return watch?.ownerKey === ownerKey ? watch : undefined;
  }

  findEquivalentWatch(ownerKey: string, candidate: Pick<GrantWatch, "queryId" | "email" | "scope" | "selectedGrantId">) {
    return this.listWatchesForOwner(ownerKey).find((watch) =>
      watch.queryId === candidate.queryId
      && watch.email.toLowerCase() === candidate.email.toLowerCase()
      && watch.scope === candidate.scope
      && watch.selectedGrantId === candidate.selectedGrantId
      && watch.status !== "paused"
    );
  }

  async deleteWatch(id: string, ownerKey?: string) {
    if (ownerKey && this.watches.get(id)?.ownerKey !== ownerKey) return false;
    const removed = this.watches.delete(id);
    await this.enqueuePersist();
    return removed;
  }

  private watchLeasePath() {
    return `${this.path}.watch-run.lock`;
  }

  async acquireWatchRunLease(owner: string, ttlMs = 10 * 60_000) {
    const path = this.watchLeasePath();
    await mkdir(resolve(path, ".."), { recursive: true });
    const payload = JSON.stringify({ owner, expiresAt: Date.now() + ttlMs });
    const create = async () => {
      const handle = await open(path, "wx");
      try {
        await handle.writeFile(payload);
      } finally {
        await handle.close();
      }
    };
    try {
      await create();
      return true;
    } catch (error: any) {
      if (error?.code !== "EEXIST") throw error;
    }
    try {
      const existing = JSON.parse(await readFile(path, "utf8"));
      if (Number(existing.expiresAt) > Date.now()) return false;
    } catch {
      // Invalid or partially written leases are treated as stale.
    }
    const stale = `${path}.stale-${process.pid}-${randomUUID()}`;
    try {
      await rename(path, stale);
    } catch {
      return false;
    }
    await unlink(stale).catch(() => undefined);
    try {
      await create();
      return true;
    } catch {
      return false;
    }
  }

  async releaseWatchRunLease(owner: string) {
    const path = this.watchLeasePath();
    try {
      const existing = JSON.parse(await readFile(path, "utf8"));
      if (existing.owner !== owner) return false;
      await unlink(path);
      return true;
    } catch {
      return false;
    }
  }

  private enqueuePersist() {
    const pending = this.persistQueue.then(() => this.persist());
    this.persistQueue = pending.catch((error) => {
      console.error(
        "[store] unable to persist GrantPilot state",
        error instanceof Error ? error.message : error,
      );
    });
    return pending;
  }

  private async persist() {
    const allSearches = [...this.searches.values()];
    const watchedQueryIds = new Set(
      this.listWatches().map((watch) => watch.queryId),
    );
    const persistedSearches = [...new Map(
      [
        ...allSearches.filter((search) => watchedQueryIds.has(search.queryId)),
        ...allSearches.slice(-10),
      ].map((search) => [search.queryId, search] as const),
    ).values()];
    const payload = JSON.stringify(
      {
        searches: persistedSearches,
        watches: this.listWatches(),
      },
      null,
      2,
    );
    await mkdir(resolve(this.path, ".."), { recursive: true });
    const temporaryPath = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporaryPath, payload);
    await rename(temporaryPath, this.path);
  }

  clear() {
    this.searches.clear();
    this.grants.clear();
    this.watches.clear();
  }
}

export const grantRepository = new GrantRepository();
await grantRepository.hydrate();
