const MAX_NAME_LENGTH = 16;

export interface MatchDataEntry {
  id: number;
  name?: string;
}

export function playerLabel(pid: string, matchData?: MatchDataEntry[], fallback?: string): string {
  const entry = matchData?.find((p) => p.id === Number(pid));
  const name = entry?.name || fallback || `P${Number(pid) + 1}`;
  return name.length > MAX_NAME_LENGTH ? name.slice(0, MAX_NAME_LENGTH) + '…' : name;
}
