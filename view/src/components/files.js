import { FileAttachment } from "npm:@observablehq/stdlib";

export const files = {
  la_paz: { file: FileAttachment("../data/la_paz.csv"), name: "La Paz" },
  cochabamba: {
    file: FileAttachment("../data/cochabamba.csv"),
    name: "Cochabamba",
  },
  santa_cruz: {
    file: FileAttachment("../data/santa_cruz.csv"),
    name: "Santa Cruz",
  },
};
