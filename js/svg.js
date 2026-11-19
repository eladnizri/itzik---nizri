// SVG -> polylines in millimetres. Shared by both input routes: MuPDF's SVG writer
// (PDF) and Potrace (images). Only the command subset those two emit is accepted;
// anything else throws rather than silently producing geometry that gets cut into
// material.
//   MuPDF  emits: absolute M L H V C Z
//   Potrace emits: absolute M, relative l c z
const FLATTEN_TOL_MM = 0.05; // chord deviation; invisible on a laser, keeps nodes sane
const WELD_MM = 0.01;        // endpoints closer than this are the same point
const I = [1, 0, 0, 1, 0, 0];

// toMM maps a point in SVG user units (after element transforms) to millimetres,
// Y-up. Each route supplies its own, because only it knows the page/image height.
export function svgToPolys(svgText, toMM) {
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const err = doc.querySelector("parsererror");
  if (err) throw new Error("פלט SVG לא תקין");

  const defs = new Map();
  for (const p of doc.querySelectorAll("defs path")) defs.set(p.id, p.getAttribute("d"));

  const polys = [];
  walk(doc.documentElement, I);
  return polys;

  function walk(el, m) {
    for (const child of el.children) {
      const tag = child.tagName.toLowerCase();
      if (tag === "defs" || tag === "clippath") continue; // clips are ignored by design
      const cm = mul(m, parseTransform(child.getAttribute("transform")));
      if (tag === "path") {
        emit(child.getAttribute("d"), cm);
      } else if (tag === "use") {
        const href = child.getAttribute("href") ||
          child.getAttributeNS("http://www.w3.org/1999/xlink", "href") || "";
        const d = defs.get(href.slice(1));
        if (d) emit(d, cm);
      } else {
        walk(child, cm); // <g> and friends
      }
    }
  }

  // Points become millimetres before flattening so the tolerance is physical: a glyph
  // lives in a 0..1 box scaled by its font size, and flattening there is meaningless.
  function emit(d, m) {
    if (!d) return;
    const map = (x, y) => toMM(m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]);
    for (const sub of parsePath(d, map)) {
      const pts = [sub.start];
      for (const seg of sub.segs) {
        if (seg[0] === "L") pts.push(seg[1]);
        else flattenCubic(pts[pts.length - 1], seg[1], seg[2], seg[3], pts, 0);
      }
      const poly = cleanup(pts, sub.closed);
      if (poly) polys.push(poly);
    }
  }
}

function parsePath(d, map) {
  const toks = d.match(/[A-Za-z]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g) || [];
  const subs = [];
  let i = 0, cmd = "", cur = null;
  let x = 0, y = 0, sx = 0, sy = 0; // current point and subpath start, in source units
  const num = () => parseFloat(toks[i++]);
  const push = (seg) => {
    if (!cur) throw new Error("נתיב SVG שאינו מתחיל ב-M");
    cur.segs.push(seg);
  };
  const open = () => {
    sx = x; sy = y;
    cur = { start: map(x, y), segs: [], closed: false };
    subs.push(cur);
  };

  while (i < toks.length) {
    if (/[A-Za-z]/.test(toks[i])) cmd = toks[i++];
    switch (cmd) {
      // Extra coordinate pairs after a moveto are implicit linetos.
      case "M": x = num();  y = num();  open(); cmd = "L"; break;
      case "m": x += num(); y += num(); open(); cmd = "l"; break;

      case "L": x = num();  y = num();  push(["L", map(x, y)]); break;
      case "l": x += num(); y += num(); push(["L", map(x, y)]); break;
      case "H": x = num();              push(["L", map(x, y)]); break;
      case "h": x += num();             push(["L", map(x, y)]); break;
      case "V": y = num();              push(["L", map(x, y)]); break;
      case "v": y += num();             push(["L", map(x, y)]); break;

      case "C": {
        const c1 = map(num(), num());
        const c2 = map(num(), num());
        x = num(); y = num();
        push(["C", c1, c2, map(x, y)]);
        break;
      }
      case "c": {
        // Control points are relative to the current point, which only moves at the end.
        const c1 = map(x + num(), y + num());
        const c2 = map(x + num(), y + num());
        x += num(); y += num();
        push(["C", c1, c2, map(x, y)]);
        break;
      }

      case "Z": case "z":
        if (cur) cur.closed = true;
        x = sx; y = sy; // a following relative moveto starts from the subpath start
        cur = null;
        cmd = ""; // a bare number here is malformed and must hit the throw below
        break;

      default:
        throw new Error(`פקודת SVG לא נתמכת: "${cmd || toks[i]}"`);
    }
  }
  return subs;
}

// Adaptive de Casteljau subdivision against a chord-deviation tolerance.
function flattenCubic(p0, c1, c2, p1, out, depth) {
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
  const chord2 = dx * dx + dy * dy;
  let flat;
  if (chord2 < 1e-12) {
    // Degenerate chord: fall back to how far the controls stray from the anchor.
    flat = Math.hypot(c1[0] - p0[0], c1[1] - p0[1]) < FLATTEN_TOL_MM &&
           Math.hypot(c2[0] - p0[0], c2[1] - p0[1]) < FLATTEN_TOL_MM;
  } else {
    const d1 = Math.abs((c1[0] - p1[0]) * dy - (c1[1] - p1[1]) * dx);
    const d2 = Math.abs((c2[0] - p1[0]) * dy - (c2[1] - p1[1]) * dx);
    const dd = d1 + d2;
    flat = dd * dd <= FLATTEN_TOL_MM * FLATTEN_TOL_MM * 16 * chord2;
  }
  if (flat || depth >= 16) { out.push(p1); return; }

  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const a1 = mid(p0, c1), a2 = mid(c1, c2), a3 = mid(c2, p1);
  const b1 = mid(a1, a2), b2 = mid(a2, a3);
  const m = mid(b1, b2);
  flattenCubic(p0, a1, b1, m, out, depth + 1);
  flattenCubic(m, b2, a3, p1, out, depth + 1);
}

function cleanup(pts, closed) {
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > WELD_MM) out.push(p);
  }
  // A closed POLYLINE must not repeat its first vertex; the closed flag does that.
  if (out.length > 2) {
    const a = out[0], b = out[out.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= WELD_MM) { out.pop(); closed = true; }
  }
  return out.length < 2 ? null : { pts: out, closed };
}

// A transform attribute holds a LIST of functions that must all be composed.
// Potrace emits "translate(0,400) scale(0.1,-0.1)" - dropping the scale would
// silently produce geometry ten times the wrong size.
function parseTransform(s) {
  if (!s || !s.trim()) return I;
  let m = I, matched = 0, g;
  const re = /(matrix|translate|scale)\s*\(([^)]*)\)/g;
  while ((g = re.exec(s))) {
    matched++;
    const v = g[2].trim().split(/[\s,]+/).map(Number);
    if (v.some(Number.isNaN)) throw new Error(`טרנספורם SVG פגום: "${s}"`);
    const t = g[1] === "matrix" ? v
      : g[1] === "translate" ? [1, 0, 0, 1, v[0], v[1] || 0]
      : [v[0], 0, 0, v.length > 1 ? v[1] : v[0], 0, 0]; // scale
    m = mul(m, t);
  }
  if (!matched) throw new Error(`טרנספורם SVG לא נתמך: "${s}"`);
  return m;
}

const mul = (a, b) => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];

export function bbox(polys) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of polys) for (const [x, y] of p.pts) {
    if (x < x0) x0 = x; if (y < y0) y0 = y;
    if (x > x1) x1 = x; if (y > y1) y1 = y;
  }
  return polys.length ? { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 } : null;
}
