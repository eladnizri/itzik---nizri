// Polylines (mm, Y-up) -> DXF R12.
//
// Deliberately minimal for RDWorks / LaserCut: AC1009, old-style POLYLINE with
// VERTEX/SEQEND rather than LWPOLYLINE (R14+), no BLOCKs, no SPLINEs, fixed-point
// decimals. DXF carries no units; RDWorks assumes mm.
//
// Each poly may name a `layer`; RDWorks maps layer and colour to its own cut
// settings, which is how bend lines get scored instead of cut through.

const ACI = { CUT: 1, BEND: 5, ENGRAVE: 3 }; // red, blue, green
const FALLBACK = [2, 4, 6, 8, 9]; // for any other name

export function toDXF(polys) {
  const names = [...new Set(polys.map((p) => p.layer || "0"))];
  const colour = (n, i) => (n === "0" ? 7 : ACI[n] ?? FALLBACK[i % FALLBACK.length]);

  const out = [];
  const g = (code, value) => out.push(String(code), String(value));
  const n = (v) => v.toFixed(4);

  g(0, "SECTION"); g(2, "HEADER");
  g(9, "$ACADVER"); g(1, "AC1009");
  g(0, "ENDSEC");

  // A LAYER table so strict readers do not have to invent the layers themselves.
  g(0, "SECTION"); g(2, "TABLES");
  g(0, "TABLE"); g(2, "LTYPE"); g(70, 1);
  g(0, "LTYPE"); g(2, "CONTINUOUS"); g(70, 0); g(3, "Solid line");
  g(72, 65); g(73, 0); g(40, "0.0");
  g(0, "ENDTAB");
  g(0, "TABLE"); g(2, "LAYER"); g(70, names.length);
  names.forEach((name, i) => {
    g(0, "LAYER"); g(2, name); g(70, 0); g(62, colour(name, i)); g(6, "CONTINUOUS");
  });
  g(0, "ENDTAB");
  g(0, "ENDSEC");

  g(0, "SECTION"); g(2, "ENTITIES");
  for (const p of polys) {
    const layer = p.layer || "0";
    g(0, "POLYLINE");
    g(8, layer);
    g(66, 1);               // vertices follow - old readers require this
    g(70, p.closed ? 1 : 0);
    g(10, "0.0"); g(20, "0.0"); g(30, "0.0");
    for (const [x, y] of p.pts) {
      g(0, "VERTEX"); g(8, layer);
      g(10, n(x)); g(20, n(y)); g(30, "0.0");
    }
    g(0, "SEQEND"); g(8, layer);
  }
  g(0, "ENDSEC");

  g(0, "EOF");
  return out.join("\r\n") + "\r\n";
}
