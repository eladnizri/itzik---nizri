import { pdfToPolys, bbox } from "./pdf.js";
import { toDXF } from "./dxf.js";

const $ = (id) => document.getElementById(id);
const drop = $("drop"), canvas = $("preview"), stats = $("stats");
const widthInput = $("width"), dlBtn = $("download"), status = $("status");

let state = null; // { name, polys, box }

drop.addEventListener("click", () => $("file").click());
$("file").addEventListener("change", (e) => e.target.files[0] && load(e.target.files[0]));
drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  if (e.dataTransfer.files[0]) load(e.dataTransfer.files[0]);
});
widthInput.addEventListener("input", render);
dlBtn.addEventListener("click", download);

async function load(file) {
  say("טוען…");
  try {
    const { polys, pageCount } = pdfToPolys(new Uint8Array(await file.arrayBuffer()));
    const box = bbox(polys);
    if (!box) { say("לא נמצאו וקטורים בקובץ. ייתכן שזה PDF סרוק (תמונה)."); return; }
    state = { name: file.name.replace(/\.pdf$/i, ""), polys, box };
    widthInput.value = box.w.toFixed(1);
    say(pageCount > 1 ? `נטען. שים לב: בקובץ ${pageCount} עמודים, הומר רק הראשון.` : "");
    render();
  } catch (err) {
    state = null;
    say("שגיאה: " + err.message);
    console.error(err);
  }
}

// Target width drives a uniform scale; everything else stays as parsed.
function scaled() {
  const target = parseFloat(widthInput.value);
  const k = target > 0 && state.box.w > 0 ? target / state.box.w : 1;
  return state.polys.map((p) => ({
    closed: p.closed,
    pts: p.pts.map(([x, y]) => [(x - state.box.x0) * k, (y - state.box.y0) * k]),
  }));
}

function render() {
  if (!state) return;
  const polys = scaled();
  const box = bbox(polys);
  const open = polys.filter((p) => !p.closed).length;
  const nodes = polys.reduce((s, p) => s + p.pts.length, 0);

  stats.innerHTML =
    `<b>${box.w.toFixed(1)} × ${box.h.toFixed(1)} מ"מ</b> · ${polys.length} נתיבים · ${nodes} נקודות` +
    (open ? ` · <span class="warn">${open} פתוחים</span>` : "");

  const ctx = canvas.getContext("2d");
  const W = canvas.width = canvas.clientWidth * devicePixelRatio;
  const H = canvas.height = canvas.clientHeight * devicePixelRatio;
  ctx.clearRect(0, 0, W, H);
  const pad = 20 * devicePixelRatio;
  const k = Math.min((W - 2 * pad) / box.w, (H - 2 * pad) / box.h);
  const ox = (W - box.w * k) / 2, oy = (H - box.h * k) / 2;
  ctx.lineWidth = Math.max(1, devicePixelRatio);
  for (const p of polys) {
    ctx.beginPath();
    p.pts.forEach(([x, y], i) => {
      const cx = ox + x * k, cy = H - oy - y * k; // mm Y-up -> canvas Y-down
      i ? ctx.lineTo(cx, cy) : ctx.moveTo(cx, cy);
    });
    if (p.closed) ctx.closePath();
    ctx.strokeStyle = p.closed ? "#111" : "#d00"; // open paths are the usual laser surprise
    ctx.stroke();
  }
  dlBtn.disabled = false;
}

function download() {
  const blob = new Blob([toDXF(scaled())], { type: "application/dxf" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = state.name + ".dxf";
  a.click();
  URL.revokeObjectURL(a.href);
}

const say = (msg) => { status.textContent = msg; };
addEventListener("resize", render);
