import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { GrantResult, GrantWatch, SearchOutput } from "../domain/types.js";

class GrantRepository {
  private searches = new Map<string, SearchOutput>();
  private grants = new Map<string, GrantResult>();
  private watches = new Map<string, GrantWatch>();
  private path = resolve(process.env.GRANTPILOT_STORE_PATH ?? "cache/grants/state.json");
  private persistQueue: Promise<void> = Promise.resolve();

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

  async deleteWatch(id: string) {
    const removed = this.watches.delete(id);
    await this.enqueuePersist();
    return removed;
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
    const payload = JSON.stringify(
      {
        searches: [...this.searches.values()].slice(-10),
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
