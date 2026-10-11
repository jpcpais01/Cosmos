/** Slowly drifting, twinkling stars behind the loading screen; stops by itself once the screen is removed. */
export function startSplashStars(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  let w = 0;
  let h = 0;
  const resize = () => {
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener('resize', resize);
  const n = Math.round(Math.min(700, Math.max(160, (w * h) / 2400)));
  const stars = Array.from({ length: n }, () => ({
    x: Math.random(),
    y: Math.random(),
    m: Math.random() ** 3, // mostly faint, a few bright
    phase: Math.random() * Math.PI * 2,
    speed: 0.4 + Math.random(),
  }));
  const t0 = performance.now();
  const frame = (now: number) => {
    if (!canvas.isConnected) {
      window.removeEventListener('resize', resize);
      return;
    }
    const t = (now - t0) / 1000;
    const fadeIn = Math.min(1, t / 1.8);
    ctx.clearRect(0, 0, w, h);
    for (const s of stars) {
      const x = ((((s.x - t * 0.002 * s.speed) % 1) + 1) % 1) * w;
      const a = (0.2 + 0.8 * s.m) * (0.75 + 0.25 * Math.sin(t * s.speed * 1.6 + s.phase)) * fadeIn;
      ctx.globalAlpha = a;
      ctx.fillStyle = s.m > 0.5 ? '#dce8ff' : '#ffffff';
      ctx.beginPath();
      ctx.arc(x, s.y * h, 0.4 + s.m * 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
