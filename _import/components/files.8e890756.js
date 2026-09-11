import { FileAttachment } from "../../_observablehq/stdlib.js";

export const files = {
  la_paz: { file: FileAttachment("../../data/la_paz.csv", import.meta.url), name: "La Paz" },
  cochabamba: {
    file: FileAttachment("../../data/cochabamba.csv", import.meta.url),
    name: "Cochabamba",
  },
  santa_cruz: {
    file: FileAttachment("../../data/santa_cruz.csv", import.meta.url),
    name: "Santa Cruz",
  },
};
