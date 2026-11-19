// PDF -> polylines in millimetres, Y-up, origin at the page's bottom-left corner.
//
// Route: MuPDF renders the page to SVG. We use SVG rather than MuPDF's device
// callbacks because the WASM build does not export fz_outline_glyph, so live text
// is only reachable as vectors through the SVG writer, which outlines it for us.
import * as mupdf from "../vendor/mupdf/mupdf.js";

const PT_TO_MM = 25.4 / 72;
const FLATTEN_TOL_MM = 0.05; // chord deviation; invisible on a laser, keeps node count sane
const WELD_MM = 0.01;        // endpoints closer than this are the same point

export function pdfToPolys(bytes, pageNo = 0) {
  const doc = mupdf.Document.openDocument(bytes, "application/pdf");
  const page = doc.loadPage(pageNo);
  const box = page.getBounds(); // [x0, y0, x1, y1] in points

  const buf = new mupdf.Buffer();
  const writer = new mupdf.DocumentWriter(buf, "svg", "text=path");
  const dev = writer.beginPage(box);
  page.run(dev, mupdf.Matrix.identity);
  dev.close();
  writer.endPage();
  writer.close();

  return {
    polys: svgToPolys(buf.asString(), box[3] - box[1]),
    pageCount: doc.countPages(),
  };
}

// --- SVG -> polylines -------------------------------------------------------
// Only the subset MuPDF's writer emits: absolute M, L, H, V, C, Z. Anything else
// throws rather than silently producing geometry that would be cut into material.
function svgToPolys(svgText, heightPt) {
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const defs = new Map();
  for (const p of doc.querySelectorAll("defs path")) defs.set(p.id, p.getAttribute("d"));

  const polys = [];
  walk(doc.documentElement, [1, 0, 0, 1, 0, 0]);
  return polys;

  function walk(el, m) {
    for (const child of el.children) {
      const tag = child.tagName.toLowerCase();
      if (tag === "defs" || tag === "clippath") continue; // clips are ignored by design
      const cm = mul(m, parseMatrix(child.getAttribute("transform")));
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

  // Points are mapped to millimetres before flattening so the tolerance is physical:
  // a glyph lives in a 0..1 box scaled by its font size, and flattening there would
  // be meaningless.
  function emit(d, m) {
    if (!d) return;
    const toMM = (x, y) => {
      const X = m[0] * x + m[2] * y + m[4];
      const Y = m[1] * x + m[3] * y + m[5];
      return [X * PT_TO_MM, (heightPt - Y) * PT_TO_MM];
    };
    for (const sub of parsePath(d, toMM)) {
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
  let i = 0, cmd = "", cur = null, x = 0, y = 0;
  const num = () => parseFloat(toks[i++]);
  const push = (seg) => {
    if (!cur) throw new Error("נתיב SVG שאינו מתחיל ב-M");
    cur.segs.push(seg);
  };

  while (i < toks.length) {
    if (/[A-Za-z]/.test(toks[i])) cmd = toks[i++];
    switch (cmd) {
      case "M":
        x = num(); y = num();
        cur = { start: map(x, y), segs: [], closed: false };
        subs.push(cur);
        cmd = "L"; // extra coordinate pairs after M are implicit linetos
        break;
      case "L": x = num(); y = num(); push(["L", map(x, y)]); break;
      case "H": x = num();            push(["L", map(x, y)]); break;
      case "V": y = num();            push(["L", map(x, y)]); break;
      case "C": {
        const c1 = map(num(), num());
        const c2 = map(num(), num());
        x = num(); y = num();
        push(["C", c1, c2, map(x, y)]);
        break;
      }
      case "Z":
        if (cur) cur.closed = true;
        cur = null;
        cmd = ""; // a number here is malformed and must fall through to the throw
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
  if (out.length < 2) return null;
  return { pts: out, closed };
}

const parseMatrix = (s) => {
  if (!s) return [1, 0, 0, 1, 0, 0];
  const m = s.match(/matrix\(([^)]+)\)/);
  if (m) return m[1].split(/[\s,]+/).map(Number);
  const t = s.match(/translate\(([^)]+)\)/);
  if (t) { const v = t[1].split(/[\s,]+/).map(Number); return [1, 0, 0, 1, v[0], v[1] || 0]; }
  throw new Error(`טרנספורם SVG לא נתמך: "${s}"`);
};

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
