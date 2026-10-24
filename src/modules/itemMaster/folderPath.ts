export type FolderPathNode = {
  id: string;
  value: string;
};

/**
 * Walk from a folder up to the root.
 * `get` returns the parent id plus the value to collect (code or name).
 * Returns nodes root → leaf.
 */
export async function folderPathUp(
  startId: string | null | undefined,
  get: (
    id: string,
  ) => Promise<{ parentId: string | null; value: string } | null>,
): Promise<FolderPathNode[]> {
  const nodes: FolderPathNode[] = [];
  const seen = new Set<string>();
  let current = startId ?? null;

  while (current) {
    if (seen.has(current)) throw new Error("Folder cycle detected");
    seen.add(current);
    const row = await get(current);
    if (!row) throw new Error("Folder not found");
    nodes.push({ id: current, value: row.value });
    current = row.parentId;
  }

  return nodes.reverse();
}
