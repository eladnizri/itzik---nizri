import { pdfToPolys } from "./pdf.js";
import { imageToPolys } from "./raster.js";
import { bbox } from "./svg.js";
import { toDXF } from "./dxf.js";

const $ = (id) => document.getElementById(id);
const drop = $("drop"), canvas = $("preview"), stats = $("stats");
const widthInput = $("width"), dlBtn = $("download"), status = $("status");
const thrRow = $("thrRow"), thr = $("thr"), thrVal = $("thrVal"), thrAuto = $("thrAuto");
const txtRow = $("txtRow"), noText = $("noText"), selAll = $("selAll");

let drag = null, view = null; // view: the mm->canvas mapping render() last used

let state = null; // { name, polys, box, file?, pixels?, threshold? }

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
thr.addEventListener("input", () => { thrVal.textContent = thr.value; retrace(+thr.value); });
thrAuto.addEventListener("click", () => retrace(null));
noText.addEventListener("change", reparse);
selAll.addEventListener("click", () => applyPolys(state.all, ""));

canvas.addEventListener("pointerdown", (e) => {
  if (!state?.polys) return;
  canvas.setPointerCapture(e.pointerId);
  drag = { x0: e.offsetX, y0: e.offsetY, x1: e.offsetX, y1: e.offsetY };
});
canvas.addEventListener("pointermove", (e) => {
  if (!drag) return;
  drag.x1 = e.offsetX; drag.y1 = e.offsetY;
  render();
});
canvas.addEventListener("pointerup", () => {
  const d = drag;
  drag = null;
  if (!d) return;
  if (Math.hypot(d.x1 - d.x0, d.y1 - d.y0) < 8) return render(); // a click, not a drag
  select(d);
});

// Only paths wholly inside the rectangle are kept. A dimension line that crosses the
// edge belongs to the drawing sheet, not to the part being cut.
function select(d) {
  const dpr = devicePixelRatio;
  const toMM = (cx, cy) => [(cx * dpr - view.ox) / view.k,
                            (view.H - view.oy - cy * dpr) / view.k];
  const [ax, ay] = toMM(d.x0, d.y0), [bx, by] = toMM(d.x1, d.y1);
  const r = { x0: Math.min(ax, bx), x1: Math.max(ax, bx),
              y0: Math.min(ay, by), y1: Math.max(ay, by) };
  const hit = state.all.filter((p) => {
    const b = bbox([p]);
    return b.x0 >= r.x0 && b.x1 <= r.x1 && b.y0 >= r.y0 && b.y1 <= r.y1;
  });
  if (!hit.length) return say("לא נבחר דבר. סמן מלבן שמכיל נתיבים שלמים.");
  applyPolys(hit, `נבחרו ${hit.length} מתוך ${state.all.length} נתיבים.`);
}

// The selection filters, it never rescales: the width is reset to the selection's own
// true size so the output still measures what the drawing says.
function applyPolys(polys, msg) {
  state.polys = polys;
  state.box = bbox(polys);
  widthInput.value = state.box.w.toFixed(1);
  selAll.hidden = polys === state.all;
  say(msg);
  render();
}

async function load(file) {
  const isPDF = /\.pdf$/i.test(file.name) || file.type === "application/pdf";
  say("טוען…");
  dlBtn.disabled = true;
  try {
    const name = file.name.replace(/\.[^.]+$/, "");
    if (isPDF) {
      thrRow.hidden = true;
      txtRow.hidden = false;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { polys, pageCount } = pdfToPolys(bytes, { text: !noText.checked });
      const box = bbox(polys);
      if (!box) return say("לא נמצאו וקטורים בקובץ. ייתכן שזה PDF סרוק — נסה להמיר אותו לתמונה.");
      state = { name, polys, all: polys, box, bytes };
      widthInput.value = box.w.toFixed(1); // the PDF's own size is the honest default
      say(pageCount > 1 ? `שים לב: בקובץ ${pageCount} עמודים, הומר רק הראשון.` : "");
    } else {
      thrRow.hidden = false;
      txtRow.hidden = true;
      state = { name, file };
      await trace(null, 100); // an image has no physical size; 100 mm until told otherwise
      if (!state.polys) return;
    }
    render();
  } catch (err) {
    state = null;
    say("שגיאה: " + err.message);
    console.error(err);
  }
}

async function trace(threshold, widthMM) {
  const r = await imageToPolys(state.file, { threshold, widthMM });
  const box = bbox(r.polys);
  if (!box) { say("לא נמצאה צורה. נסה לשנות את הסף."); return; }
  // The geometry is cropped to its content, so the honest mm/pixel figure uses the
  // content's own pixel width, not the image's.
  Object.assign(state, { polys: r.polys, all: r.polys, box, threshold: r.threshold,
                         contentPx: box.w / r.mmPerPixel });
  selAll.hidden = true;
  thr.value = r.threshold;
  thrVal.textContent = r.threshold;
  widthInput.value = widthInput.value || widthMM.toFixed(1);
  say("");
}

// Re-reading the PDF is cheap (tens of milliseconds) and keeps one source of truth.
function reparse() {
  if (!state?.bytes) return;
  try {
    const { polys } = pdfToPolys(state.bytes, { text: !noText.checked });
    const box = bbox(polys);
    if (!box) return say("לא נשארה גאומטריה. בטל את הסימון כדי להחזיר את הטקסט.");
    Object.assign(state, { polys, all: polys, box });
    selAll.hidden = true;
    widthInput.value = box.w.toFixed(1);
    say(""); render();
  } catch (err) { say("שגיאה: " + err.message); }
}

async function retrace(threshold) {
  if (!state?.file) return;
  say("עוקב…");
  try { await trace(threshold, parseFloat(widthInput.value) || 100); render(); }
  catch (err) { say("שגיאה: " + err.message); }
}

// The target width drives one uniform scale; nothing else is resampled.
function scaled() {
  const target = parseFloat(widthInput.value);
  const k = target > 0 && state.box.w > 0 ? target / state.box.w : 1;
  return state.polys.map((p) => ({
    closed: p.closed,
    pts: p.pts.map(([x, y]) => [(x - state.box.x0) * k, (y - state.box.y0) * k]),
  }));
}

function render() {
  if (!state?.polys) return;
  const polys = scaled();
  const box = bbox(polys);
  const open = polys.filter((p) => !p.closed).length;
  const nodes = polys.reduce((s, p) => s + p.pts.length, 0);

  let line = `<b>${box.w.toFixed(1)} × ${box.h.toFixed(1)} מ"מ</b> · ${polys.length} נתיבים · ${nodes} נקודות`;
  if (open) line += ` · <span class="warn">${open} פתוחים</span>`;
  if (state.contentPx) {
    // For a traced image this is the real accuracy ceiling, so it is not hidden away.
    // Curved edges land within roughly 1.5 pixels of true; straight edges are exact.
    const mmpx = box.w / state.contentPx;
    line += ` · <span class="${mmpx > 0.5 ? "warn" : "mut"}">דיוק ${mmpx.toFixed(3)} מ"מ/פיקסל</span>`;
  }
  // Specks from JPEG noise or dust become real cuts, so they are surfaced rather than
  // silently dropped - only the user knows whether a small dot is detail or dirt.
  const tiny = polys.filter((p) => { const b = bbox([p]); return b.w < 1 && b.h < 1; }).length;
  if (tiny) line += ` · <span class="warn">${tiny} זעירים (&lt;1 מ"מ)</span>`;
  stats.innerHTML = line;

  const ctx = canvas.getContext("2d");
  const W = canvas.width = canvas.clientWidth * devicePixelRatio;
  const H = canvas.height = canvas.clientHeight * devicePixelRatio;
  ctx.clearRect(0, 0, W, H);
  const pad = 20 * devicePixelRatio;
  const k = Math.min((W - 2 * pad) / box.w, (H - 2 * pad) / box.h);
  const ox = (W - box.w * k) / 2, oy = (H - box.h * k) / 2;
  view = { k, ox, oy, H };
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
  if (drag) {
    const dpr = devicePixelRatio;
    ctx.setLineDash([6 * dpr, 4 * dpr]);
    ctx.strokeStyle = "#2d6a4f";
    ctx.lineWidth = 1.5 * dpr;
    ctx.strokeRect(drag.x0 * dpr, drag.y0 * dpr,
                   (drag.x1 - drag.x0) * dpr, (drag.y1 - drag.y0) * dpr);
    ctx.setLineDash([]);
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
