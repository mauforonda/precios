import { html } from "npm:htl";

export function Trend(
  value,
  {
    locale = "en-US",
    format,
    positive = "red",
    negative = "green",
    base = "muted",
    positiveSuffix = " ↗︎",
    negativeSuffix = " ↘︎",
    baseSuffix = "",
  } = {}
) {
  const variant = value > 0 ? positive : value < 0 ? negative : base;
  const text = value.toLocaleString(locale, {
    signDisplay: "always",
    style: "percent",
    ...format,
  });
  const suffix =
    value > 0 ? positiveSuffix : value < 0 ? negativeSuffix : baseSuffix;
  return html`<span class="small ${variant}">${text}${suffix}</span>`;
}