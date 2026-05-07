export function drawDoor(
  x: CanvasRenderingContext2D,
  W: number,
  _doorY: number,
  nc: string,
  GAME_HEIGHT: number,
): void {
  const doorW = 44; const doorH = 60;
  const doorX = W / 2 - doorW / 2;
  const doorY = GAME_HEIGHT - doorH - 4;
  const frameX = doorX - 10;
  const frameY = doorY - 10;
  const frameW = doorW + 20;
  const frameH = doorH + 14;

  x.fillStyle = '#3a2878'; x.globalAlpha = 0.42;
  x.fillRect(frameX, frameY, frameW, frameH);
  x.fillStyle = '#2a1858'; x.globalAlpha = 0.32;
  x.fillRect(doorX - 6, doorY - 6, doorW + 12, doorH + 8);
  x.fillStyle = '#120a28'; x.globalAlpha = 0.4;
  x.fillRect(frameX + 1, frameY + 1, frameW - 2, frameH - 2);
  x.globalAlpha = 0.3;
  x.fillStyle = '#4a3888'; x.fillRect(doorX - 8, doorY - 10, doorW + 16, 3);
  x.globalAlpha = 0.45;
  x.fillStyle = '#0a0818'; x.fillRect(doorX, doorY, doorW, doorH);
  x.globalAlpha = 0.35;
  x.fillStyle = '#0e0828';
  x.fillRect(doorX + 4, doorY + 4, doorW - 8, doorH / 2 - 5);
  x.fillRect(doorX + 4, doorY + doorH / 2 + 1, doorW - 8, doorH / 2 - 5);
  x.strokeStyle = '#1a1040'; x.lineWidth = 1; x.globalAlpha = 0.5;
  x.strokeRect(doorX + 5, doorY + 5, doorW - 10, doorH / 2 - 7);
  x.strokeRect(doorX + 5, doorY + doorH / 2 + 2, doorW - 10, doorH / 2 - 7);
  x.fillStyle = nc; x.globalAlpha = 0.6;
  x.fillRect(doorX + doorW - 12, doorY + doorH / 2 - 4, 4, 8);
  x.globalAlpha = 0.3; x.fillRect(doorX + doorW - 13, doorY + doorH / 2 - 5, 6, 10);
  x.globalAlpha = 1;
  x.strokeStyle = nc; x.lineWidth = 1; x.globalAlpha = 0.14;
  x.strokeRect(doorX - 2, doorY - 2, doorW + 4, doorH + 4); x.globalAlpha = 1;
  const labelW = 60; const labelH = 18;
  const labelX = W / 2 - labelW / 2; const labelY = doorY - 26;
  x.globalAlpha = 0.5; x.fillStyle = '#0a0818'; x.fillRect(labelX, labelY, labelW, labelH); x.globalAlpha = 1;
  x.strokeStyle = nc; x.globalAlpha = 0.3; x.strokeRect(labelX, labelY, labelW, labelH); x.globalAlpha = 1;
  x.fillStyle = nc; x.globalAlpha = 0.85; x.font = 'bold 10px monospace'; x.textAlign = 'center';
  x.fillText('← EXIT', W / 2, labelY + 13); x.globalAlpha = 1;
  x.fillStyle = nc; x.globalAlpha = 0.02; x.fillRect(doorX - 20, doorY + doorH, doorW + 40, 16); x.globalAlpha = 1;
}
