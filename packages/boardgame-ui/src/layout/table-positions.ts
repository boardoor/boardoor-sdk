export interface TablePositions {
  bottom: string;
  top: string[];
  left: string | null;
  right: string | null;
}

export function computeTablePositions(bottomNum: number, numPlayers: number): TablePositions {
  const others: string[] = [];
  for (let i = 1; i < numPlayers; i++) {
    others.push(String((bottomNum + i) % numPlayers));
  }

  if (numPlayers <= 2) {
    return { bottom: String(bottomNum), top: others, left: null, right: null };
  }
  if (numPlayers === 3) {
    return { bottom: String(bottomNum), top: [others[1]], left: others[0], right: null };
  }
  if (numPlayers === 4) {
    return { bottom: String(bottomNum), top: [others[1]], left: others[0], right: others[2] };
  }
  // 5+ players
  return {
    bottom: String(bottomNum),
    top: others.slice(1, -1),
    left: others[0],
    right: others[others.length - 1],
  };
}
