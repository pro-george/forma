/** 2D helpers for outlines in the XY plane (mm). */
import type { Vec2, Profile } from '../document/types.js';

export const signedArea = (p: readonly Vec2[]): number => {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i]!;
    const [x2, y2] = p[(i + 1) % p.length]!;
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
};

export const ensureCCW = (p: readonly Vec2[]): Vec2[] => (signedArea(p) < 0 ? [...p].reverse() : [...p]);
export const ensureCW = (p: readonly Vec2[]): Vec2[] => (signedArea(p) > 0 ? [...p].reverse() : [...p]);

/** Oriented contours (outer CCW, holes CW) ready for a Positive-fill CrossSection. */
export const profileContours = (profile: Profile): Vec2[][] => [
  ensureCCW(profile.outer),
  ...profile.holes.map(ensureCW),
];

export function pointInPolygon(pt: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false;
  const [x, y] = pt;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Chaikin corner cutting; endpoints stay fixed (open polyline). */
export function chaikin(points: readonly Vec2[], rounds: number): Vec2[] {
  let a: Vec2[] = points.map((p) => [p[0], p[1]]);
  for (let k = 0; k < rounds; k++) {
    const out: Vec2[] = [a[0]!];
    for (let i = 0; i < a.length - 1; i++) {
      const p = a[i]!, q = a[i + 1]!;
      out.push([p[0] * 0.75 + q[0] * 0.25, p[1] * 0.75 + q[1] * 0.25], [p[0] * 0.25 + q[0] * 0.75, p[1] * 0.25 + q[1] * 0.75]);
    }
    out.push(a[a.length - 1]!);
    a = out;
  }
  return a;
}

/** Ramer–Douglas–Peucker for a closed loop. */
export function simplifyLoop(pts: Vec2[], eps: number): Vec2[] {
  if (pts.length < 4) return pts;
  const out: Vec2[] = [];
  const rec = (a: number, b: number) => {
    let maxD = 0, idx = -1;
    const [ax, ay] = pts[a]!, [bx, by] = pts[b]!;
    const L = Math.hypot(bx - ax, by - ay) || 1e-9;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i]!;
      const d = Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / L;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > eps) { rec(a, idx); rec(idx, b); } else out.push(pts[a]!);
  };
  let far = 0, fd = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i]![0] - pts[0]![0], pts[i]![1] - pts[0]![1]);
    if (d > fd) { fd = d; far = i; }
  }
  rec(0, far);
  rec(far, pts.length - 1);
  out.push(pts[pts.length - 1]!);
  return out;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Axis-aligned rounded rectangle centred on the origin, CCW. */
export function roundedRect(width: number, depth: number, radius: number, cornerSegments = 8): Vec2[] {
  const r = Math.max(0, Math.min(radius, width / 2, depth / 2));
  const pts: Vec2[] = [];
  const corner = (cx: number, cy: number, a0: number) => {
    for (let i = 0; i <= cornerSegments; i++) {
      const a = a0 + (i / cornerSegments) * (Math.PI / 2);
      pts.push([r3(cx + Math.cos(a) * r), r3(cy + Math.sin(a) * r)]);
    }
  };
  if (r === 0) return [[width / 2, depth / 2], [-width / 2, depth / 2], [-width / 2, -depth / 2], [width / 2, -depth / 2]];
  corner(width / 2 - r, depth / 2 - r, 0);
  corner(-width / 2 + r, depth / 2 - r, Math.PI / 2);
  corner(-width / 2 + r, -depth / 2 + r, Math.PI);
  corner(width / 2 - r, -depth / 2 + r, Math.PI * 1.5);
  return pts;
}

export function circle(radius: number, segments = 48, cx = 0, cy = 0): Vec2[] {
  const p: Vec2[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    p.push([r3(cx + Math.cos(a) * radius), r3(cy + Math.sin(a) * radius)]);
  }
  return p;
}

export function regularPolygon(sides: number, radius: number, rotationDeg = 0): Vec2[] {
  return circle(radius, sides).map(([x, y]) => {
    const a = (rotationDeg * Math.PI) / 180;
    return [r3(x * Math.cos(a) - y * Math.sin(a)), r3(x * Math.sin(a) + y * Math.cos(a))];
  });
}

export function translatePoints(pts: readonly Vec2[], dx: number, dy: number): Vec2[] {
  return pts.map(([x, y]) => [r3(x + dx), r3(y + dy)]);
}

export function bounds(loops: readonly (readonly Vec2[])[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const l of loops) for (const [x, y] of l) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  return { minX, minY, maxX, maxY };
}
