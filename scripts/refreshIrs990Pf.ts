import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import { ingestIrs990Pf } from "./ingestIrs990Pf.js";

type DownloadState = Record<string, { etag?: string; lastModified?: string }>;

const csvPath = resolve(process.env.IRS_INDEX_CSV_PATH ?? "data/raw/irs-teos/2026/index_2026.csv");
const xmlRoot = resolve(process.env.IRS_XML_ROOT ?? "data/raw/irs-teos/2026");
const statePath = resolve(process.env.IRS_REFRESH_STATE_PATH ?? "cache/grants/irs-download-state.json");
const indexUrl = process.env.IRS_INDEX_DOWNLOAD_URL?.trim();
const archiveUrls = (process.env.IRS_XML_DOWNLOAD_URLS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const readState = async (): Promise<DownloadState> => {
  try {
    return JSON.parse(await readFile(statePath, "utf8"));
  } catch {
    return {};
  }
};

async function download(url: string, target: string, state: DownloadState) {
  const prior = state[url] ?? {};
  const response = await fetch(url, {
    headers: {
      ...(prior.etag ? { "if-none-match": prior.etag } : {}),
      ...(prior.lastModified ? { "if-modified-since": prior.lastModified } : {}),
    },
    signal: AbortSignal.timeout(10 * 60_000),
  });
  if (response.status === 304) return false;
  if (!response.ok || !response.body) {
    throw new Error(`IRS source download failed (${response.status}) for ${url}`);
  }
  await mkdir(resolve(target, ".."), { recursive: true });
  const temporary = `${target}.${process.pid}.download`;
  await pipeline(Readable.fromWeb(response.body as any), createWriteStream(temporary));
  await rename(temporary, target);
  state[url] = {
    etag: response.headers.get("etag") ?? undefined,
    lastModified: response.headers.get("last-modified") ?? undefined,
  };
  return true;
}

async function extractZip(path: string) {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn("unzip", ["-oq", path, "-d", xmlRoot], { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolvePromise() : reject(new Error(`unzip exited with code ${code}`))
    );
  });
}

async function main() {
  const state = await readState();
  let changed = false;
  if (indexUrl) changed = await download(indexUrl, csvPath, state) || changed;
  const archiveRoot = resolve(xmlRoot, "archives");
  for (const url of archiveUrls) {
    const target = resolve(archiveRoot, basename(new URL(url).pathname));
    const downloaded = await download(url, target, state);
    if (downloaded) await extractZip(target);
    changed = downloaded || changed;
  }
  await mkdir(resolve(statePath, ".."), { recursive: true });
  await writeFile(statePath, JSON.stringify(state, null, 2));
  if (!indexUrl && !archiveUrls.length) {
    console.log("[irs] no download URLs configured; checking staged IRS files for changes");
  } else {
    console.log(changed ? "[irs] source files changed; rebuilding the 990-PF index" : "[irs] remote IRS files are unchanged");
  }
  await ingestIrs990Pf();
}

main().catch((error) => {
  console.error("[irs] refresh failed", error);
  process.exitCode = 1;
});
