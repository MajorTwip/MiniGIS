export function userFromHeaders(
  headers: Record<string, string | string[] | undefined>,
  headerName: string,
): string | null {
  const wanted = headerName.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() !== wanted) continue;
    const first = Array.isArray(v) ? v[0] : v;
    const trimmed = first?.trim();
    return trimmed ? trimmed : null;
  }
  return null;
}
