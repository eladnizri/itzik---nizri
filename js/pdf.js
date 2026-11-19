// PDF -> polylines in millimetres, Y-up, origin at the page's bottom-left corner.
//
// MuPDF renders the page to SVG and we parse that, rather than using MuPDF's device
// callbacks, because the WASM build does not export fz_outline_glyph: the SVG writer
// is the only route that turns live text into outlines.
import * as mupdf from "../vendor/mupdf/mupdf.js";
import { svgToPolys } from "./svg.js";

const PT_TO_MM = 25.4 / 72;

export function pdfToPolys(bytes, { pageNo = 0, text = true } = {}) {
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

  const heightPt = box[3] - box[1];
  const toMM = (x, y) => [x * PT_TO_MM, (heightPt - y) * PT_TO_MM];
  return { polys: svgToPolys(buf.asString(), toMM, { text }), pageCount: doc.countPages() };
}
