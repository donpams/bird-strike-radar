// "Wind map" style flow along the flyways: hundreds of short-lived particles drift through
// a vector field and leave fading trails (the look of earth.nullschool / windy.com).
//
// The field is built from the four flyway centre lines: near a line, the flow follows the
// line's direction (north in spring, south in autumn); a gentle meander term keeps the
// streaks from looking ruled. Particles live in lon/lat space and are projected each frame,
// so they stay pinned to the geography while the map moves.
import { FLYWAYS, seasonOf, smooth } from "./flyways.js";

const SIGMA = 2.4; // corridor half-width, degrees
const LINES = FLYWAYS.map((f) => smooth(f.coords, 12)); // south -> north
const rand = (a, b) => a + Math.random() * (b - a);

// Nearest point on each flyway line -> weighted tangent (unit, south->north)
function field(lon, lat) {
  const k = Math.cos((lat * Math.PI) / 180);
  let vx = 0;
  let vy = 0;
  let wsum = 0;
  for (const line of LINES) {
    let best = Infinity;
    let tx = 0;
    let ty = 0;
    for (let i = 0; i < line.length - 1; i++) {
      const [ax, ay] = line[i];
      const [bx, by] = line[i + 1];
      const dx = (bx - ax) * k;
      const dy = by - ay;
      const px = (lon - ax) * k;
      const py = lat - ay;
      const len2 = dx * dx + dy * dy || 1e-9;
      const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
      const ex = px - t * dx;
      const ey = py - t * dy;
      const d2 = ex * ex + ey * ey;
      if (d2 < best) {
        best = d2;
        const len = Math.sqrt(len2);
        tx = dx / len;
        ty = dy / len;
      }
    }
    const w = Math.exp(-best / (SIGMA * SIGMA));
    vx += tx * w;
    vy += ty * w;
    wsum += w;
  }
  return { vx, vy, w: wsum };
}

export function createWind(map, getState) {
  const container = map.getCanvasContainer();
  const canvas = document.createElement("canvas");
  canvas.className = "wind";
  container.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  let w = 0;
  let h = 0;
  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // the canvas container itself has no size; measure the map's outer element
    w = map.getContainer().clientWidth;
    h = map.getContainer().clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();

  const N = window.innerWidth < 720 ? 260 : 620;
  const spawn = (p) => {
    const line = LINES[Math.floor(Math.random() * LINES.length)];
    const i = Math.floor(Math.random() * (line.length - 1));
    const f = Math.random();
    const [ax, ay] = line[i];
    const [bx, by] = line[i + 1];
    const k = Math.cos((ay * Math.PI) / 180);
    // offset perpendicular to the line, denser near the centre
    const nx = -(by - ay);
    const ny = (bx - ax) * k;
    const nl = Math.hypot(nx, ny) || 1;
    const off = (Math.random() + Math.random() + Math.random() - 1.5) * SIGMA * 1.1;
    p.lon = ax + (bx - ax) * f + (nx / nl) * off / k;
    p.lat = ay + (by - ay) * f + (ny / nl) * off;
    p.age = 0;
    p.life = rand(70, 170);
    p.speed = rand(0.7, 1.25);
    p.seed = Math.random() * 1000;
    p.trail = []; // recent positions (lon/lat), newest last
    return p;
  };
  const particles = Array.from({ length: N }, () => spawn({}));
  particles.forEach((p) => (p.age = Math.floor(rand(0, p.life)))); // stagger

  let alpha = 0; // eased visibility (fades in and out with the season)
  map.on("resize", resize);

  // Trails are stored as recent geographic positions and fully redrawn every frame.
  // (An earlier version faded the previous frame instead; 8-bit alpha rounding never quite
  // reaches zero, which left faint "stains" on the dark basemap.)
  const TRAIL = 12;
  const BUCKETS = 4; // draw trails in a few alpha bands: newest segments brightest

  let raf = 0;
  let last = 0;
  const tick = (now) => {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(100, now - (last || now - 16)) / 33; // frame-rate independent
    last = now;
    const { month, theme } = getState();
    const season = seasonOf(month);
    alpha += ((season === "none" ? 0 : 1) - alpha) * Math.min(1, 0.05 * dt);

    ctx.clearRect(0, 0, w, h);
    if (alpha < 0.01) {
      particles.forEach((p) => (p.trail.length = 0));
      return;
    }

    const dir = season === "south" ? -1 : 1;
    const dark = theme === "dark";
    const t = now / 1000;
    const zoomScale = Math.pow(2, 3.6 - map.getZoom()); // similar screen speed at any zoom

    // 1. advance particles
    for (const p of particles) {
      p.age += dt;
      const f = field(p.lon, p.lat);
      if (p.age > p.life || f.w < 0.04) {
        spawn(p);
        continue;
      }
      const sway = Math.sin(t * 0.6 + p.seed + p.lat * 0.5) * 0.45; // gentle meander
      const vx = (f.vx - f.vy * sway) * dir;
      const vy = (f.vy + f.vx * sway) * dir;
      const step = 0.055 * p.speed * zoomScale * dt;
      const k = Math.cos((p.lat * Math.PI) / 180) || 1;
      p.lon += (vx * step) / k;
      p.lat += vy * step;
      // Sample the trail every ~33 ms regardless of frame rate, so trails are the same
      // length on a fast laptop and a slow phone; between samples the head just moves.
      p.acc = (p.acc || 0) + dt;
      if (p.acc >= 1 || p.trail.length < 2) {
        p.acc = 0;
        p.trail.push([p.lon, p.lat]);
        if (p.trail.length > TRAIL) p.trail.shift();
      } else {
        p.trail[p.trail.length - 1] = [p.lon, p.lat];
      }
    }

    // 2. project each trail once, then draw in alpha bands (tail faint -> head bright)
    const screen = particles.map((p) => {
      // fade each particle in at birth and out before it dies
      const lifeFade = Math.min(1, p.age / 12, (p.life - p.age) / 12);
      return { pts: p.trail.map((c) => map.project(c)), lifeFade };
    });
    ctx.lineWidth = dark ? 1.25 : 1.15;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const rgb = dark ? "94, 234, 212" : "14, 143, 134";
    const base = (dark ? 0.42 : 0.38) * alpha;
    for (let b = 0; b < BUCKETS; b++) {
      for (const lifeBand of [0.35, 1]) {
        ctx.beginPath();
        for (const s of screen) {
          if ((s.lifeFade < 0.6) !== (lifeBand < 1)) continue;
          const n = s.pts.length;
          const from = Math.floor((b / BUCKETS) * (n - 1));
          const to = Math.floor(((b + 1) / BUCKETS) * (n - 1));
          if (to <= from) continue;
          ctx.moveTo(s.pts[from].x, s.pts[from].y);
          for (let i = from + 1; i <= to; i++) ctx.lineTo(s.pts[i].x, s.pts[i].y);
        }
        ctx.strokeStyle = `rgba(${rgb}, ${base * ((b + 1) / BUCKETS) * lifeBand})`;
        ctx.stroke();
      }
    }
  };
  raf = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(raf);
    map.off("resize", resize);
    canvas.remove();
  };
}
