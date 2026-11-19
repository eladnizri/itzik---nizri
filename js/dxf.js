// Polylines (mm, Y-up) -> DXF R12.
//
// Deliberately minimal for RDWorks / LaserCut: AC1009, old-style POLYLINE with
// VERTEX/SEQEND rather than LWPOLYLINE (R14+), no BLOCKs, no SPLINEs, everything
// on layer 0, fixed-point decimals. DXF carries no units; RDWorks assumes mm.
// shortcut: no LAYER/LTYPE tables, upgrade if RDWorks rejects the file.

export function toDXF(polys) {
  const out = [];
  const g = (code, value) => out.push(String(code), String(value));
  const n = (v) => v.toFixed(4);

  g(0, "SECTION"); g(2, "HEADER");
  g(9, "$ACADVER"); g(1, "AC1009");
  g(0, "ENDSEC");

  g(0, "SECTION"); g(2, "ENTITIES");
  for (const p of polys) {
    g(0, "POLYLINE");
    g(8, "0");
    g(66, 1);               // vertices follow - old readers require this
    g(70, p.closed ? 1 : 0);
    g(10, "0.0"); g(20, "0.0"); g(30, "0.0");
    for (const [x, y] of p.pts) {
      g(0, "VERTEX"); g(8, "0");
      g(10, n(x)); g(20, n(y)); g(30, "0.0");
    }
    g(0, "SEQEND"); g(8, "0");
  }
  g(0, "ENDSEC");

  g(0, "EOF");
  return out.join("\r\n") + "\r\n";
}
