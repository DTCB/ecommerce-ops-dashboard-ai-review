import { useId } from "react";
import {
  formatNumber, gmvAxis, monthName, shortMonth, signed,
  type Basis, type Comparison, type Month,
} from "./data";

const compact = new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 2 });

export function TrendChart({ month, basis, onSelect, records, currency, imported, amountLabel }: {
  month: string; basis: Basis; onSelect: (month: string) => void; records: Month[]; currency: string; imported: boolean; amountLabel: string;
}) {
  const gradientId = useId();
  const activeIndex = records.findIndex(record => record.month === month);
  const start = Math.max(0, Math.min(activeIndex - 5, records.length - 12));
  const visible = records.slice(start, start + 12);
  const points = visible.map((record, index) => ({
    month: record.month,
    value: record.gmv / (basis === "daily" ? record.days : 1),
    x: visible.length === 1 ? 250 : 51 + 396 * index / (visible.length - 1),
  }));
  const maximum = Math.max(1, ...points.map(point => point.value));
  const step = imported ? Math.max(0.01, 10 ** Math.floor(Math.log10(maximum)) / 2) : basis === "daily" ? 10000 : 300000;
  const topValue = Math.ceil(maximum / step) * step;
  const y = (value: number) => 169 - value / topValue * 143;
  const active = points.find(point => point.month === month)!;
  const ordinal = (period: string) => Number(period.slice(0, 4)) * 12 + Number(period.slice(5));
  const segments: typeof points[] = [];
  points.forEach((point, index) => {
    if (!index || ordinal(point.month) - ordinal(points[index - 1].month) > 1) segments.push([]);
    segments[segments.length - 1].push(point);
  });
  const ticks = Array.from({ length: 5 }, (_, index) => index * topValue / 4);
  const activeY = y(active.value);
  const labelX = Math.min(411, Math.max(53, active.x - 39));

  return (
    <svg className="chart-svg trend-svg" viewBox="0 0 470 202" role="group" aria-label={`月度 ${amountLabel} 趋势，选择月份查看指标`}>
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#3b59ea" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#3b59ea" stopOpacity="0.015" />
        </linearGradient>
      </defs>
      {ticks.map(tick => (
        <g key={tick}>
          <line x1="51" x2="449" y1={y(tick)} y2={y(tick)} className="chart-grid" />
          <text x="40" y={y(tick) + 4} textAnchor="end" className="chart-label">{tick ? imported ? compact.format(tick) : gmvAxis(tick, basis) : "0"}</text>
        </g>
      ))}
      {segments.map(segment => {
        const line = segment.map(point => `${point.x},${y(point.value)}`).join(" ");
        return <g key={segment[0].month}>
          <polygon points={`${segment[0].x},169 ${line} ${segment[segment.length - 1].x},169`} fill={`url(#${gradientId})`} />
          <polyline points={line} fill="none" stroke="#4b5de5" strokeWidth="2.7" strokeLinejoin="round" strokeLinecap="round" />
        </g>;
      })}
      <line x1={active.x} x2={active.x} y1={activeY} y2="169" stroke="#5264e9" strokeDasharray="4 4" />
      {points.map(point => {
        const selected = point.month === month;
        return (
          <g
            key={point.month} tabIndex={0} role="button" aria-pressed={selected} className="trend-point"
            aria-label={`${monthName(point.month)}，${amountLabel} ${formatNumber(point.value, 2)} ${currency}`}
            onClick={() => onSelect(point.month)}
            onKeyDown={event => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(point.month);
              }
            }}
          >
            <title>{`${monthName(point.month)} · ${currency} ${formatNumber(point.value, 2)}`}</title>
            <rect x={point.x - 18} y="20" width="36" height="178" fill="transparent" />
            {selected && <circle cx={point.x} cy={y(point.value)} r="11" fill="#dfe4ff" />}
            <circle className="point-dot" cx={point.x} cy={y(point.value)} r={selected ? 5 : 3.5} fill={selected ? "#4b5de5" : "#fff"} stroke="#4b5de5" strokeWidth="2" />
            <text x={point.x} y="190" textAnchor="middle" className={selected ? "chart-label active-chart-label" : "chart-label"}>
              {visible[0].month.slice(0, 4) === visible[visible.length - 1].month.slice(0, 4)
                ? shortMonth(point.month) : point.month.slice(2).replace("-", "/")}
            </text>
          </g>
        );
      })}
      <g pointerEvents="none">
        <rect x={labelX} y={activeY - 30} width="78" height="21" rx="5" fill="#252d58" />
        <text x={labelX + 39} y={activeY - 15.5} textAnchor="middle" fill="white" fontSize="11" fontWeight="650">
          {imported ? compact.format(active.value) : basis === "daily" ? `${formatNumber(active.value / 1000, 2)} 千` : `${formatNumber(active.value / 10000, 2)} 万`}
        </text>
      </g>
    </svg>
  );
}

export function BridgeChart({ comparison, basis, currency, imported = false, amountLabel }: {
  comparison: Comparison; basis: Basis; currency: string; imported?: boolean; amountLabel: string;
}) {
  const { previous, current } = comparison.metrics.gmv;
  const intermediate = previous + comparison.order_effect;
  const max = Math.max(previous, current, intermediate);
  const min = Math.min(previous, current, intermediate) * 0.94;
  const span = max - min || 1;
  const bottom = 153;
  const y = (value: number) => bottom - (value - min) / span * 111;
  const endpoint = (value: number) => imported ? compact.format(value) : gmvAxis(value, basis);
  const effect = (value: number) => imported
    ? `${value < 0 ? "−" : value > 0 ? "+" : ""}${compact.format(Math.abs(value))}`
    : `${signed(value / (basis === "daily" ? 1000 : 10000))} ${basis === "daily" ? "千" : "万"}`;
  const bars = [
    { x: 39, end: previous, start: min, fill: "#a7b2f7", label: `上月 ${amountLabel}`, value: endpoint(previous) },
    { x: 141, end: intermediate, start: previous, fill: comparison.order_effect < 0 ? "#ef8a89" : "#46bba3", label: "订单量影响", value: effect(comparison.order_effect) },
    { x: 243, end: current, start: intermediate, fill: comparison.aov_effect < 0 ? "#ef8a89" : "#46bba3", label: "客单价影响", value: effect(comparison.aov_effect) },
    { x: 345, end: current, start: min, fill: "#5264e9", label: `本月 ${amountLabel}`, value: endpoint(current) },
  ];
  const aria = `${amountLabel}拆解，订单量影响 ${signed(comparison.order_effect)}，客单价影响 ${signed(comparison.aov_effect)} ${currency}。纵轴从 ${formatNumber(min)} 开始。`;
  return (
    <svg className="chart-svg bridge-svg" viewBox="0 0 444 193" role="img" aria-label={aria}>
      {[42, 79, 116, 153].map(row => <line key={row} x1="19" x2="425" y1={row} y2={row} className="chart-grid" />)}
      {bars.slice(0, -1).map((bar, index) => (
        <line key={bar.label} x1={bar.x + 60} x2={bars[index + 1].x} y1={y(bar.end)} y2={y(bar.end)} stroke="#aab3c7" strokeDasharray="4 4" />
      ))}
      {bars.map((bar, index) => {
        const top = y(Math.max(bar.start, bar.end));
        const height = Math.max(2, y(Math.min(bar.start, bar.end)) - top);
        const color = index === 0 || index === 3 ? "#354261" : bar.end < bar.start ? "#b53742" : "#12715b";
        return (
          <g key={bar.label}>
            <rect x={bar.x} y={top} width="60" height={height} rx="3" fill={bar.fill} />
            <text x={bar.x + 30} y={top - 9} textAnchor="middle" fontSize="13" fontWeight="700" fill={color}>{bar.value}</text>
            <text x={bar.x + 30} y="174" textAnchor="middle" className="chart-label">{bar.label}</text>
          </g>
        );
      })}
      <text x="20" y="190" className="chart-note">纵轴起点 {currency} {formatNumber(min)}</text>
    </svg>
  );
}
