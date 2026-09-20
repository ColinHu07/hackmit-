import * as THREE from 'three';

/** A small, repeatable world-space texture: visible landmarks between every step,
 * with no network asset or extra geometry per blade of grass. */
export function meadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  let seed = 197;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  ctx.fillStyle = '#91aa72'; ctx.fillRect(0, 0, 512, 512);
  // Broad patches help read translation even on small screens.
  for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
    const x = col * 64, y = row * 64;
    ctx.fillStyle = (row + col) % 2 ? '#9bb67c' : '#89a568';
    ctx.globalAlpha = 0.55; ctx.fillRect(x, y, 64, 64);
    ctx.globalAlpha = 0.28; ctx.fillStyle = '#d1cf9a';
    ctx.beginPath(); ctx.ellipse(x + 18 + random() * 28, y + 18 + random() * 28, 15 + random() * 15, 9 + random() * 8, random() * Math.PI, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  for (let i = 0; i < 1800; i++) {
    const x = random() * 512, y = random() * 512;
    ctx.strokeStyle = i % 3 ? '#68834f' : '#c5d797';
    ctx.globalAlpha = 0.25 + random() * 0.25;
    ctx.lineWidth = 1 + random(); ctx.beginPath();
    ctx.moveTo(x, y); ctx.lineTo(x - 2, y - 3 - random() * 5);
    ctx.moveTo(x, y); ctx.lineTo(x + 3, y - 2 - random() * 5); ctx.stroke();
  }
  ctx.globalAlpha = 0.8;
  for (let i = 0; i < 32; i++) {
    const x = 8 + random() * 496, y = 8 + random() * 496;
    ctx.fillStyle = '#61794e'; ctx.beginPath(); ctx.ellipse(x + 1, y + 2, 4, 2.7, 0.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = i % 2 ? '#dbd5b6' : '#b5b99c';
    ctx.beginPath(); ctx.ellipse(x, y, 4, 2.5, 0.4, 0, Math.PI * 2); ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(6, 6);
  texture.anisotropy = 4;
  return texture;
}

export function pawTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.ellipse(32, 40, 13, 11, 0, 0, Math.PI * 2); ctx.fill();
  for (const [x, y] of [[16, 24], [30, 17], [45, 23]]) {
    ctx.beginPath(); ctx.ellipse(x!, y!, 5.5, 7, 0, 0, Math.PI * 2); ctx.fill();
  }
  return new THREE.CanvasTexture(canvas);
}
