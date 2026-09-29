import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "../scale.js";

// Ambient flocks that drift across the screen now and then.
// They follow the season shown on the timeline, so the decoration still says something:
//   spring (Mar-May)  -> fly north        autumn (Aug-Nov) -> fly south
//   rest of the year  -> fewer flocks, drifting east-west
// Flocks appear more often in months with a higher national damaging-strike rate.

const SPRING = new Set([2, 3, 4]);
const AUTUMN = new Set([7, 8, 9, 10]);
const rand = (a, b) => a + Math.random() * (b - a);

function headingFor(month) {
  // Screen angle in radians (0 = east, -PI/2 = north/up)
  if (SPRING.has(month)) return rand(-Math.PI / 2 - 0.45, -Math.PI / 2 + 0.35);
  if (AUTUMN.has(month)) return rand(Math.PI / 2 - 0.35, Math.PI / 2 + 0.45);
  return Math.random() < 0.5 ? rand(-0.25, 0.25) : Math.PI + rand(-0.25, 0.25);
}

function makeFlock(w, h, month) {
  const angle = headingFor(month);
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  // Enter from the edge the flock is flying away from, aimed across the middle band
  const cx = w * rand(0.25, 0.75);
  const cy = h * rand(0.25, 0.7);
  // Distance from (cx, cy) back to the screen edge along the heading, plus a margin so the
  // formation (which trails behind the leader) starts fully off-screen
  const toEdge = (p, d, size) => (d > 0 ? p / d : d < 0 ? (size - p) / -d : Infinity);
  const back = Math.min(toEdge(cx, dx, w), toEdge(cy, dy, h)) + 30;
  const start = { x: cx - dx * back, y: cy - dy * back };
  const reach = back;
  const n = Math.round(rand(5, 11));
  const spacing = rand(13, 18);
  const birds = [];
  for (let i = 0; i < n; i++) {
    // V formation: leader at the front, alternating left/right arms, plus a little jitter
    const rank = Math.ceil(i / 2);
    const side = i === 0 ? 0 : i % 2 ? 1 : -1;
    const back = rank * spacing;
    const across = side * rank * spacing * 0.75;
    birds.push({
      ox: -dx * back - dy * across + rand(-3, 3),
      oy: -dy * back + dx * across + rand(-3, 3),
      size: rand(4.2, 6.2),
      flap: rand(0, Math.PI * 2),
      flapSpeed: rand(7, 9.5),
      drift: rand(0, Math.PI * 2),
    });
  }
  const speed = rand(55, 80);
  // Long enough to cross the whole screen plus the formation's tail
  const life = (reach + Math.hypot(w, h) + n * spacing) / speed;
  return { x: start.x, y: start.y, dx, dy, speed, age: 0, life, birds };
}

function drawBird(ctx, x, y, size, flap, angle) {
  // A small gull-like "m": two wing arcs whose tips rise and fall with the flap phase
  const lift = Math.sin(flap) * size * 0.75;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle + Math.PI / 2); // birds face their direction of travel
  ctx.beginPath();
  ctx.moveTo(-size * 1.2, -lift);
  ctx.quadraticCurveTo(-size * 0.55, -size * 0.55 - lift * 0.3, 0, 0);
  ctx.quadraticCurveTo(size * 0.55, -size * 0.55 - lift * 0.3, size * 1.2, -lift);
  ctx.stroke();
  ctx.restore();
}

export default function Birds({ month, national, theme }) {
  const canvas = useRef(null);
  const monthRef = useRef(month);
  const themeRef = useRef(theme);
  monthRef.current = month;
  themeRef.current = theme;

  useEffect(() => {
    if (prefersReducedMotion()) return;
    const c = canvas.current;
    const ctx = c.getContext("2d");
    let w = 0;
    let h = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = c.clientWidth;
      h = c.clientHeight;
      c.width = w * dpr;
      c.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const maxRate = Math.max(...national);
    const flocks = [];
    let nextIn = 3.5; // first flock shortly after load
    let last = performance.now();
    let raf = 0;

    const tick = (now) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.25, (now - last) / 1000); // clamp big gaps (e.g. after a tab switch)
      last = now;

      nextIn -= dt;
      if (nextIn <= 0 && flocks.length < 2) {
        flocks.push(makeFlock(w, h, monthRef.current));
        // Busier migration months -> shorter gaps (roughly 14 s at the peak, 32 s at the low)
        const busy = national[monthRef.current] / maxRate;
        nextIn = rand(0.85, 1.15) * (32 - 18 * busy);
      }

      ctx.clearRect(0, 0, w, h);
      const dark = themeRef.current === "dark";
      ctx.lineWidth = 1.3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      for (let i = flocks.length - 1; i >= 0; i--) {
        const f = flocks[i];
        f.age += dt;
        f.x += f.dx * f.speed * dt;
        f.y += f.dy * f.speed * dt;
        if (f.age > f.life) {
          flocks.splice(i, 1);
          continue;
        }
        // Fade in and out at the ends of the crossing so nothing pops
        const edge = Math.min(1, f.age / 2.5, (f.life - f.age) / 2.5);
        const alpha = (dark ? 0.55 : 0.42) * edge;
        ctx.strokeStyle = dark ? `rgba(226, 236, 245, ${alpha})` : `rgba(28, 34, 44, ${alpha})`;
        const angle = Math.atan2(f.dy, f.dx);
        for (const b of f.birds) {
          b.flap += b.flapSpeed * dt;
          b.drift += dt * 0.9;
          // gentle individual sway so the formation breathes
          const sway = Math.sin(b.drift) * 2.2;
          drawBird(ctx, f.x + b.ox - f.dy * sway, f.y + b.oy + f.dx * sway, b.size, b.flap, angle);
        }
      }
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
    // national is static for the session
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas ref={canvas} className="birds" aria-hidden="true" />;
}
