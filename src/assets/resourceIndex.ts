// Runtime index of the gitignored ./mbg-data/ asset folder, built from the
// filesystem.manifest file that ships alongside the game data. Provides
// case-insensitive existence checks and path→URL resolution, mirroring how
// Torque (and MBHaxe's ResourceLoader) treat asset paths.

const DATA_URL_ROOT = "/mbg-data";

export class ResourceIndex {
  // lowercase "data/..." path -> actual-cased path relative to data root
  private files = new Map<string, string>();

  private constructor() {}

  static async load(): Promise<ResourceIndex> {
    const res = await fetch(`${DATA_URL_ROOT}/filesystem.manifest`);
    if (!res.ok) {
      throw new Error(
        `Could not load mbg-data/filesystem.manifest (${res.status}). ` +
          `Populate ./mbg-data/ with the game data folder.`,
      );
    }
    const entries = (await res.json()) as { original: string; path: string }[];
    const index = new ResourceIndex();
    for (const entry of entries) {
      index.files.set(entry.path.toLowerCase(), entry.path);
    }
    return index;
  }

  // path is "data/..."-rooted, e.g. "data/interiors/beginner/training1.dif"
  exists(path: string): boolean {
    return this.files.has(path.toLowerCase());
  }

  // Returns the fetchable URL for a "data/..."-rooted path, or null.
  resolve(path: string): string | null {
    const actual = this.files.get(path.toLowerCase());
    if (actual === undefined) return null;
    // Manifest paths start with "data/"; the folder is served at /mbg-data/.
    return `${DATA_URL_ROOT}/${actual.replace(/^data\//, "")}`;
  }

  // All data paths starting with prefix and ending with suffix (actual case).
  listFiles(prefix: string, suffix: string): string[] {
    const lowerPrefix = prefix.toLowerCase();
    const lowerSuffix = suffix.toLowerCase();
    const results: string[] = [];
    for (const [lower, actual] of this.files) {
      if (lower.startsWith(lowerPrefix) && lower.endsWith(lowerSuffix)) results.push(actual);
    }
    results.sort();
    return results;
  }

  async loadArrayBuffer(path: string): Promise<ArrayBuffer> {
    const url = this.resolve(path);
    if (url === null) throw new Error(`Missing asset: ${path}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
    return res.arrayBuffer();
  }
}

export function dirname(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.substring(0, idx);
}
