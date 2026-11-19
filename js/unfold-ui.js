import { unfold, stripPolys, MATERIALS } from "./unfold.js";
import { toDXF } from "./dxf.js";

const $ = (id) => document.getElementById(id);
const ins = ["legs", "width", "t", "r", "ang", "k"].map($);
let last = null;

$("mat").innerHTML = Object.keys(MATERIALS).map((m) => `<option>${m}</option>`).join("");
$("mat").addEventListener("change", () => { $("k").value = MATERIALS[$("mat").value]; go(); });
ins.forEach((el) => el.addEventListener("input", go));
$("dl").addEventListener("click", download);
go();

function read() {
  const legs = $("legs").value.split(/[,\s]+/).map(Number).filter((v) => v > 0);
  return { legs, width: +$("width").value, thickness: +$("t").value,
           radius: +$("r").value, angle: +$("ang").value, k: +$("k").value };
}

function go() {
  const o = read();
  if (o.legs.length < 2 || !(o.width > 0) || !(o.thickness > 0) || !(o.angle > 0)) {
    $("result").textContent = "—";
    $("detail").textContent = "צריך לפחות שתי צלעות.";
    last = null; $("dl").disabled = true; return;
  }
  let u;
  try { u = unfold(o); }
  catch (err) {
    $("result").textContent = "—";
    $("detail").textContent = err.message;
    $("sens").innerHTML = "";
    last = null; $("dl").disabled = true;
    return;
  }
  last = { u, o };
  $("dl").disabled = false;

  $("result").innerHTML = `חתוך פס <b>${u.length.toFixed(2)} × ${o.width.toFixed(2)}</b> מ"מ` +
    ` <small>(סכום הצלעות ${u.sum.toFixed(2)} — קצר ב-${(u.sum - u.length).toFixed(2)})</small>`;
  $("detail").textContent =
    `${u.bends} כיפופים · ניכוי ${u.BD.toFixed(3)} לכל כיפוף · ` +
    `אזורי כיפוף במרחק ` + u.zones.map(([a, b]) =>
      `${a.toFixed(2)}–${b.toFixed(2)}`).join(" ו-") + ` מ"מ מהקצה`;

  // The K sensitivity is the honest headline: it is usually wider than the tolerance.
  const ks = [0.33, 0.36, 0.40, 0.43, 0.46];
  const rows = ks.map((k) => {
    const v = unfold({ ...o, k });
    const me = Math.abs(k - o.k) < 0.005;
    return `<tr class="${me ? "me" : ""}"><td>${k.toFixed(2)}</td><td>${v.length.toFixed(2)}</td></tr>`;
  }).join("");
  const span = unfold({ ...o, k: 0.46 }).length - unfold({ ...o, k: 0.33 }).length;
  $("sens").innerHTML =
    `<tr><th>K-factor</th><th>אורך הפס</th></tr>${rows}` +
    `<tr><td colspan="2" class="mut">טווח ${span.toFixed(2)} מ"מ — ` +
    `${span > 0.2 ? "רחב מהסבילות ברוב השרטוטים" : "צר"}</td></tr>`;

  draw(u, o.width);
}

function draw(u, width) {
  const c = $("strip"), ctx = c.getContext("2d");
  const W = c.width = c.clientWidth * devicePixelRatio;
  const H = c.height = c.clientHeight * devicePixelRatio;
  ctx.clearRect(0, 0, W, H);
  const pad = 24 * devicePixelRatio;
  const k = Math.min((W - 2 * pad) / u.length, (H - 2 * pad) / width);
  const ox = (W - u.length * k) / 2, oy = (H - width * k) / 2;
  ctx.lineWidth = Math.max(1.5, 1.5 * devicePixelRatio);
  ctx.strokeStyle = "#d00";
  ctx.strokeRect(ox, oy, u.length * k, width * k);
  ctx.strokeStyle = "#06c";
  for (const [a, b] of u.zones) {
    for (const x of [a, b]) {
      ctx.beginPath();
      ctx.moveTo(ox + x * k, oy);
      ctx.lineTo(ox + x * k, oy + width * k);
      ctx.stroke();
    }
  }
}

function download() {
  if (!last) return;
  const blob = new Blob([toDXF(stripPolys(last.u.length, last.o.width, last.u.zones))],
                        { type: "application/dxf" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `flat-${last.u.length.toFixed(1)}x${last.o.width}.dxf`;
  a.click();
  URL.revokeObjectURL(a.href);
}
