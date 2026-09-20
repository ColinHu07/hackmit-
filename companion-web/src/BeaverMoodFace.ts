/** One beaver face for the moving marker; its expression follows happiness. */
export function beaverMoodFace(happiness: number): string {
  const mood = Math.max(0, Math.min(100, happiness)) / 100;
  const smile = mood < 0.45 ? (mood - 0.45) / 0.45 : (mood - 0.45) / 0.55;
  const mouthY = 44 - Math.max(0, smile) * 2;
  const curveY = mouthY + smile * 12;
  const teethY = (mouthY + curveY) / 2;
  const browInner = 21 + Math.min(0, smile) * 5;
  const eyes = mood >= 0.85
    ? '<path d="M19 29q4-6 8 0M37 29q4-6 8 0" fill="none" stroke="#38271f" stroke-width="3" stroke-linecap="round"/>'
    : '<ellipse cx="23" cy="28" rx="3.4" ry="4.5" fill="#38271f"/><ellipse cx="41" cy="28" rx="3.4" ry="4.5" fill="#38271f"/><circle cx="24" cy="26.5" r="1.1" fill="#fff"/><circle cx="42" cy="26.5" r="1.1" fill="#fff"/>';
  return `<svg class="mood-beaver-face" viewBox="0 0 64 64" fill="none" aria-hidden="true">
    <circle cx="14" cy="16" r="6" fill="#a96332"/><circle cx="50" cy="16" r="6" fill="#a96332"/>
    <circle cx="14" cy="16" r="3" fill="#e8b180"/><circle cx="50" cy="16" r="3" fill="#e8b180"/>
    <path d="M12 30C12 17 20 10 30 10l-2-5 8 5 5-3 1 6c8 4 11 10 10 19 7 15-3 26-20 26S5 47 12 30Z" fill="#c98243"/>
    <path d="M16 34c-7 4-4 18 6 21M48 34c7 4 4 18-6 21" stroke="#b97037" stroke-width="2" stroke-linecap="round"/>
    <path d="M18 21l9 ${browInner - 21}M37 ${browInner}l9 ${21 - browInner}" stroke="#80502f" stroke-width="2.5" stroke-linecap="round"/>
    ${eyes}
    <ellipse cx="23" cy="40" rx="11" ry="8" fill="#f0d2a0"/><ellipse cx="41" cy="40" rx="11" ry="8" fill="#f0d2a0"/>
    <path d="M27 34q5-3 10 0-1 6-5 6t-5-6Z" fill="#38271f"/>
    <rect x="27" y="${teethY}" width="10" height="9" rx="2" fill="#fffdf1" stroke="#9b764f" stroke-width=".8"/>
    <path d="M32 ${teethY + 1}v7" stroke="#b8a487" stroke-width="1"/>
    <path d="M22 ${mouthY}Q32 ${curveY} 42 ${mouthY}" stroke="#65452f" stroke-width="2" stroke-linecap="round"/>
  </svg>`;
}
