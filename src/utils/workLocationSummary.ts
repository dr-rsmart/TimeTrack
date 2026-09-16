/** Count displayed active assignments, without implying other company sites are monitored. */
export function workLocationSummary(
  geofences: ReadonlyArray<{ id: string; isActive: boolean }>,
  assignedIds: readonly string[],
): string {
  const active = geofences.filter((location) => location.isActive);
  const company = `${active.length} active company location${active.length === 1 ? '' : 's'}`;
  if (assignedIds.length === 0) return `${company} · No assigned location`;
  const assigned = active.filter((location) => assignedIds.includes(location.id)).length;
  return `${assigned} ${assigned === 0 ? 'active ' : ''}assigned location${assigned === 1 ? '' : 's'} · ${company}`;
}
