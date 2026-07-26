const WIDTH = 1200;
const HEIGHT = 630;

export interface ShareCardData {
  gameName: string;
  playerRank: number; // 1-based
  totalPlayers: number;
  playerScore?: string;
  gameDate: Date;
  iconDataUrl?: string; // data:image/svg+xml;... or data:image/png;...
}

function ordinalSuffix(n: number, lang: string): string {
  if (lang === 'ja') return `${n}位`;
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

export async function renderShareCard(data: ShareCardData, lang = 'en'): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d')!;

  const isWinner = data.playerRank === 1;
  const rankText = ordinalSuffix(data.playerRank, lang);

  // ── Background ──
  const grad = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  grad.addColorStop(0, '#1a1a2e');
  grad.addColorStop(1, '#16213e');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Subtle accent glow behind rank area
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = isWinner ? '#ffd700' : '#7c6fff';
  ctx.beginPath();
  ctx.ellipse(WIDTH / 2, 340, 360, 200, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // ── Top: icon + game name row ──
  const PAD = 72;
  const iconSize = 88;
  let iconImg: HTMLImageElement | null = null;
  if (data.iconDataUrl) {
    try {
      iconImg = await loadImage(data.iconDataUrl);
    } catch {
      /* skip */
    }
  }

  const rowY = PAD;
  if (iconImg) {
    ctx.drawImage(iconImg, PAD, rowY, iconSize, iconSize);
  }

  const nameX = iconImg ? PAD + iconSize + 28 : PAD;
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 44px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(data.gameName, nameX, rowY + 8, WIDTH - nameX - PAD);

  // Sub-line: players · date
  const dateStr = data.gameDate.toLocaleDateString(lang === 'ja' ? 'ja-JP' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  const playersLabel =
    lang === 'ja' ? `${data.totalPlayers}人対戦` : `${data.totalPlayers} players`;
  ctx.fillStyle = '#8b8fa3';
  ctx.font = '22px system-ui, -apple-system, sans-serif';
  ctx.fillText(`${playersLabel}  ·  ${dateStr}`, nameX, rowY + 60);

  // ── Divider line ──
  const divY = rowY + iconSize + 36;
  ctx.strokeStyle = '#ffffff12';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, divY);
  ctx.lineTo(WIDTH - PAD, divY);
  ctx.stroke();

  // ── Centre: rank hero ──
  const rankY = 320;
  const rankLabel = lang === 'ja' ? rankText : `${rankText} Place`;

  // Rank text
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 88px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = isWinner ? '#ffd700' : '#ffffff';
  ctx.fillText(rankLabel, WIDTH / 2, rankY);

  // Winner underline accent
  if (isWinner) {
    const accentW = 120;
    ctx.fillStyle = '#ffd700';
    roundRect(ctx, (WIDTH - accentW) / 2, rankY + 54, accentW, 4, 2);
    ctx.fill();
  }

  // ── Score ──
  if (data.playerScore != null) {
    ctx.fillStyle = '#c8cad0';
    ctx.font = '32px system-ui, -apple-system, sans-serif';
    const scoreLabel = lang === 'ja' ? `スコア: ${data.playerScore}` : `Score: ${data.playerScore}`;
    ctx.fillText(scoreLabel, WIDTH / 2, rankY + 100);
  }

  // ── Bottom: branding ──
  ctx.fillStyle = '#555868';
  ctx.font = '20px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('boardoor.com', WIDTH / 2, HEIGHT - 44);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Failed to render share card'))),
      'image/png',
    );
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.addEventListener('load', () => resolve(img), { once: true });
    img.addEventListener('error', reject, { once: true });
    img.src = src;
  });
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
