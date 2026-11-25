/** Mongo ObjectId or its string form; anything with a meaningful `String()`. */
type IdLike = { toString(): string } | string;

/**
 * Distinct id strings, dropping empty values and `exclude`
 * (e.g. notification recipients minus the acting user).
 */
export function uniqueIdsExcept(
  values: ReadonlyArray<IdLike | null | undefined>,
  exclude: string,
): string[] {
  return [...new Set(values.filter(Boolean).map(String))].filter(
    (id) => id !== exclude,
  );
}
