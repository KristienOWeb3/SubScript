/* Barrel for the admin chart components.
 *
 * These used to be one 872-line file. They were split per component because the charts had real
 * defects — an axis that disagreed with its own data, a smoothing curve that drew negative volume,
 * duplicate SVG gradient ids that made a second chart on the page borrow the first one's colour —
 * and fixing six components inside one file meant six sets of unrelated edits landing on top of
 * each other. One component per module also means a chart's geometry, its accessibility and its
 * copy sit together instead of a thousand lines apart.
 *
 * This file stays at its original path and re-exports the same names, so the five analytics views
 * and the overview dashboard import exactly what they imported before. Prefer importing from the
 * specific module in new code; this exists so the split needed no call-site churn.
 *
 * Shared machinery lives in ./chartGeometry (scales, monotone interpolation, tick and label
 * thinning, formatters) and ./chartPalette (the data colours, each one measured rather than
 * eyeballed). Anything two charts must agree about belongs in those, not duplicated here.
 */

export { AreaTrendChart, type DataPoint, type ChartValueKind } from "./AreaTrendChart";
export { BarMetricChart, type BarMetricDatum } from "./BarMetricChart";
export { DonutMetricChart, type DonutSegment } from "./DonutMetricChart";
export { RunwayGaugeChart } from "./RunwayGaugeChart";
export { MetricSparkline, StatCardWithSparkline } from "./StatCards";
