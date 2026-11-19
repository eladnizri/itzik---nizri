// Flat pattern for a part whose bends are all parallel - L, U, C, Z, hat sections.
// Those unfold to a straight strip, so the whole job is one length calculation.
// Bends in two directions (a box) need corner reliefs and real CAD; not handled here.

// Starting K-factors. They are a guess until measured: K depends on the material,
// the thickness, the radius AND the press, so the UI makes this editable.
export const MATERIALS = {
  "אלומיניום 5052": 0.33,
  "אלומיניום 6061": 0.35,
  "פלדה רכה": 0.40,
  "נירוסטה 304": 0.45,
};

// legs are outside (mould-line) dimensions, as an engineering drawing gives them.
export function unfold({ legs, thickness: T, radius: R, angle = 90, k = 0.33 }) {
  // At 180 degrees the two legs are parallel, so the outside mould lines never meet and
  // the setback is infinite. A hem is measured and calculated differently; refusing is
  // the only honest answer here.
  if (!(angle > 0 && angle < 180))
    throw new Error("זווית הכיפוף חייבת להיות בין 0 ל-180. קיפול מלא (hem) מחושב אחרת.");
  if (legs.length < 2) throw new Error("צריך לפחות שתי צלעות.");

  const rad = (angle * Math.PI) / 180;
  const BA = rad * (R + k * T);              // arc length of the neutral axis
  const SB = (R + T) * Math.tan(rad / 2);    // outside setback, per leg of a bend
  const BD = 2 * SB - BA;                    // what each bend removes from the sum
  const bends = legs.length - 1;

  // Walk the strip: end legs lose one setback, inner legs lose two, each bend adds BA.
  const zones = [];
  let pos = 0;
  legs.forEach((L, i) => {
    const flat = L - (i === 0 || i === legs.length - 1 ? SB : 2 * SB);
    // A leg shorter than its own setback cannot be made: the bends would overlap.
    if (flat <= 0)
      throw new Error(`צלע ${i + 1} (${L} מ"מ) קצרה מדי לרדיוס ולעובי האלה — ` +
                      `נדרש לפחות ${(L - flat).toFixed(2)} מ"מ.`);
    pos += flat;
    if (i < bends) { zones.push([pos, pos + BA]); pos += BA; }
  });

  return { BA, SB, BD, bends, zones, length: pos,
           sum: legs.reduce((a, b) => a + b, 0) };
}

// Outer rectangle on CUT, both edges of every bend zone on BEND.
export function stripPolys(length, width, zones) {
  const polys = [{ layer: "CUT", closed: true,
    pts: [[0, 0], [length, 0], [length, width], [0, width]] }];
  for (const [a, b] of zones) {
    polys.push({ layer: "BEND", closed: false, pts: [[a, 0], [a, width]] });
    polys.push({ layer: "BEND", closed: false, pts: [[b, 0], [b, width]] });
  }
  return polys;
}
