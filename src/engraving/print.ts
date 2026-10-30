import type { Score } from "../core/model";
import type { RenderOptions } from "./pagination";
import { renderScore } from "./render";
/** Print from a separate paginated rendering, independent of the current zoom/view. */
export function preparePrint(
  score: Score,
  concert: boolean,
  options: RenderOptions,
) {
  document.querySelector("body > .print-pages")?.remove();
  const source = document.createElement("div"),
    layout = renderScore(source, score, undefined, concert, {
      ...options,
      view: "page",
      arrangement: "vertical",
    });
  const svg = source.querySelector("svg")!,
    root = document.createElement("div");
  root.className = "print-pages";
  for (const page of layout.pages ?? []) {
    const sheet = document.createElement("div");
    sheet.className = "print-sheet";
    const clone = svg.cloneNode(true) as SVGElement;
    clone.setAttribute(
      "viewBox",
      `${page.x} ${page.y} ${page.width} ${page.height}`,
    );
    clone.setAttribute("width", String(page.width));
    clone.setAttribute("height", String(page.height));
    sheet.appendChild(clone);
    root.appendChild(sheet);
  }
  document.body.appendChild(root);
}
