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
  // Soft irregular patches, with seamless wrapping at the texture edges.
  // Large color changes read as meadow habitats instead of checkerboard tiles.
  for (let i = 0; i < 75; i++) {
    const x = random() * 512, y = random() * 512, radius = 22 + random() * 65;
    for (const dx of [-512, 0, 512]) for (const dy of [-512, 0, 512]) {
      const gradient = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, radius);
      gradient.addColorStop(0, i % 3 ? 'rgba(61,105,43,0.27)' : 'rgba(227,210,141,0.38)');
      gradient.addColorStop(1, 'rgba(145,170,114,0)');
      ctx.fillStyle = gradient; ctx.fillRect(x + dx - radius, y + dy - radius, radius * 2, radius * 2);
    }
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
  texture.repeat.set(2, 2);
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
