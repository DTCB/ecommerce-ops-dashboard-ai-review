import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChartNoAxesCombined, ChevronDown, LoaderCircle, MapPin, Package, Sparkles } from "lucide-react";
import { basisName, categoryName, formatNumber, monthName, shortMonth, signed, type Diagnosis, type ProductScope, type Selection } from "./data";
import type { CheckRequest, Driver, LocalCheck, Operation, Period, ProductCheck, StateCheck, VolumeCheck } from "./diagnostic-data";
import { ProductTable } from "./product-table";

export type Diagnostic = { category: string; gmv_delta: number; driver: Driver; text: string };
type CheckState<T> = { phase: "idle" | "loading" } | { phase: "error"; message: string } | { phase: "success"; result: T };

const driverNames: Record<Driver, string> = { order_volume: "订单量", aov: "品类客单价" };
const stateNames: Record<string, string> = {
  AC: "阿克里", AL: "阿拉戈斯", AM: "亚马孙", AP: "阿马帕", BA: "巴伊亚", CE: "塞阿拉",
  DF: "联邦区", ES: "圣埃斯皮里图", GO: "戈亚斯", MA: "马拉尼昂", MG: "米纳斯吉拉斯",
  MS: "南马托格罗索", MT: "马托格罗索", PA: "帕拉", PB: "帕拉伊巴", PE: "伯南布哥", PI: "皮奥伊",
  PR: "巴拉那", RJ: "里约热内卢", RN: "北里奥格兰德", RO: "朗多尼亚", RR: "罗赖马",
  RS: "南里奥格兰德", SC: "圣卡塔琳娜", SE: "塞尔希培", SP: "圣保罗", TO: "托坎廷斯", unknown: "未识别州",
};

function regionName(state: string, imported: boolean) {
  return imported ? state || "未填写地区" : stateNames[state] ?? state;
}

function useCheck<T>({ month, basis, category, operation, state: region }: CheckRequest, auto: boolean, localCheck?: LocalCheck) {
  const [state, setState] = useState<CheckState<T>>({ phase: "idle" });
  const request = useRef<AbortController | null>(null);
  const completed = useRef(false);

  useEffect(() => () => {
    request.current?.abort();
    request.current = null;
  }, []);

  const run = useCallback(async () => {
    if (request.current || completed.current) return;
    const controller = new AbortController();
    request.current = controller;
    setState({ phase: "loading" });
    try {
      const input = { month, basis, category, operation, state: region };
      let result;
      if (localCheck) {
        result = { ...localCheck(input), ...input };
      } else {
        const response = await fetch("/api/review/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
        });
        result = await response.json().catch(() => null);
        if (!response.ok) throw new Error(typeof result?.detail === "string" ? result.detail : "分析暂时失败，请重试。");
      }
      if (result?.month !== month || result?.basis !== basis ||
          result?.category !== category || result?.operation !== operation || result?.state !== region) {
        throw new Error("分析结果与当前卡片范围不一致，请重试。");
      }
      if (request.current === controller) {
        completed.current = true;
        setState({ phase: "success", result });
      }
    } catch (error) {
      if (request.current !== controller) return;
      const message = error instanceof DOMException && error.name === "TimeoutError"
        ? "等待分析结果超时，请重试。"
        : error instanceof TypeError ? "无法连接分析服务，请重试。"
        : error instanceof Error ? error.message : "分析暂时失败，请重试。";
      setState({ phase: "error", message });
    } finally {
      if (request.current === controller) request.current = null;
    }
  }, [month, basis, category, operation, region, localCheck]);

  useEffect(() => {
    if (auto) void run();
  }, [auto, run]);

  return { state, run };
}

function VolumeResult({ result, selection, previous, currency }: {
  result: VolumeCheck; selection: Selection; previous: string; currency: string;
}) {
  const daily = selection.basis === "daily";
  const labels = { gmv: `${daily ? "日均 " : ""}GMV（${currency}）`, orders: daily ? "日均去重订单" : "去重订单", aov: `品类客单价（${currency}）` };
  function format(period: Period | null, metric: keyof Period) {
    const value = period?.[metric];
    return value == null ? "—" : formatNumber(value, metric === "orders" && !daily ? 0 : 2);
  }
  return (
    <div className="check-result">
      <table className="check-table">
        <thead><tr><th scope="col">对比指标</th><th scope="col">{shortMonth(previous)}</th><th scope="col">{shortMonth(selection.month)}</th></tr></thead>
        <tbody>{(Object.keys(labels) as (keyof Period)[]).map(metric => (
          <tr key={metric}><th scope="row">{labels[metric]}</th><td>{format(result.before, metric)}</td><td>{format(result.after, metric)}</td></tr>
        ))}</tbody>
      </table>
      {result.status === "insufficient" ? (
        <p className="check-note">{result.before ? "至少一个比较期的订单数为零，缺少品类客单价，无法拆解量价贡献。" : "缺少上月数据，当前显示本期指标。"}</p>
      ) : (
        <div className="contribution">
          <div><span>订单量贡献</span><strong>{signed(result.order_effect)} {currency}</strong></div>
          <div><span>品类客单价贡献</span><strong>{signed(result.aov_effect)} {currency}</strong></div>
          {result.order_share !== null && <p>订单量贡献占 GMV 净变化 <strong>{formatNumber(result.order_share * 100, 1)}%</strong></p>}
        </div>
      )}
      <p className="check-note">品类客单价 = 品类 GMV ÷ 品类内去重订单数。拆解先计算订单量影响，再计算客单价影响。</p>
    </div>
  );
}

function StateResult({ result, daily, volume, currency, imported, onProducts }: {
  result: StateCheck; daily: boolean; volume: VolumeCheck | null; currency: string; imported: boolean; onProducts?: (state: string) => void;
}) {
  const digits = daily ? 2 : 0;
  const first = result.rows[0];
  const region = imported ? "买家地区" : "买家州";
  const describe = (delta: number) => `${daily ? "日均" : ""}${delta < 0 ? "少" : "多"}了 ${formatNumber(Math.abs(delta), digits)} 单`;
  return (
    <div className="check-result">
      {volume?.before && result.direction !== 0 && first?.order_delta != null && (
        <p className="state-summary">该品类{describe(volume.after.orders - volume.before.orders)}，其中{regionName(first.state, imported)}{imported || first.state === "unknown" || first.state === "DF" ? "" : "州"}{describe(first.order_delta)}。</p>
      )}
      <p className="check-note">
        {first?.previous_orders === null ? "按本月订单量排序" : result.direction < 0 ? "按订单减少量排序" : result.direction > 0 ? "按订单增加量排序" : "按订单变化绝对值排序"} · {region} Top 5
      </p>
      {result.rows.length ? (
        <table className="check-table states-table">
          <thead><tr><th scope="col">{region}</th><th scope="col">{daily ? "日均订单" : "订单数"}</th><th scope="col">{daily ? "日均 GMV 差额" : "GMV 差额"}<small>{currency}</small></th></tr></thead>
          <tbody>{result.rows.map(row => (
            <tr key={row.state}>
              <th scope="row">{regionName(row.state, imported)}{!imported && row.state !== "unknown" && <small>{row.state}</small>}
                {onProducts && <button className="category-diagnose region-products" aria-label={`查看商品 · ${regionName(row.state, imported)}`}
                  onClick={() => onProducts(row.state)}>查看商品</button>}
              </th>
              <td>{row.previous_orders === null ? "—" : formatNumber(row.previous_orders, digits)} → {formatNumber(row.current_orders, digits)}
                {row.order_delta !== null && <small>{signed(row.order_delta, digits)}</small>}</td>
              <td>{row.gmv_delta === null ? "—" : signed(row.gmv_delta)}</td>
            </tr>
          ))}</tbody>
        </table>
      ) : <p className="check-note">当前比较期各州订单量持平。</p>}
    </div>
  );
}

function ProductSection({ selection, category, scope, previous, currency, localCheck }: {
  selection: Selection; category: string; scope: ProductScope; previous: string; currency: string; localCheck?: LocalCheck;
}) {
  const heading = useId();
  const panel = useRef<HTMLElement>(null);
  const products = useCheck<ProductCheck>({ ...selection, category, operation: "product_changes", state: scope.state }, true, localCheck);
  useEffect(() => {
    panel.current?.focus({ preventScroll: true });
    panel.current?.scrollIntoView({ block: "start" });
  }, []);
  return (
    <section ref={panel} tabIndex={-1} className="diagnostic-step product-section" aria-labelledby={heading}>
      <h4 id={heading}>商品变化</h4>
      <p className="check-note">
        {localCheck ? category : categoryName(category)} · {scope.state === undefined ? "全部地区" : regionName(scope.state, Boolean(localCheck))}
        {" · "}{monthName(selection.month)}对比{shortMonth(previous)} · {basisName(selection.basis)}
      </p>
      {products.state.phase === "loading" && <p className="check-note" role="status">正在计算商品变化…</p>}
      {products.state.phase === "error" && <div className="check-error" role="alert">
        <p>{products.state.message}</p><button className="secondary-button" onClick={() => void products.run()}>重试商品分析</button>
      </div>}
      {products.state.phase === "success" && <ProductTable result={products.state.result} currency={currency} basis={selection.basis} imported={Boolean(localCheck)} />}
    </section>
  );
}

type CardProps = { selection: Selection; previous: string; currency?: string; localCheck?: LocalCheck; hasRegions?: boolean; hasProducts?: boolean } & (
  { diagnostic: Diagnostic; evidence: ReactNode; exploration?: never; onShowStates?: never; onShowProducts?: never } |
  { exploration: Diagnosis; onShowStates: () => void; onShowProducts: (scope: ProductScope) => void; onViewReview?: () => void; diagnostic?: never; evidence?: never }
);

export function DiagnosticCard(props: CardProps) {
  const { diagnostic, selection, previous, evidence, exploration, onShowStates,
    onShowProducts, currency = "BRL", localCheck, hasRegions = true, hasProducts = true } = props;
  const onViewReview = "onViewReview" in props ? props.onViewReview : undefined;
  const title = useId();
  const [reportProducts, setReportProducts] = useState<ProductScope>();
  const category = diagnostic ? diagnostic.category : exploration.category;
  const volume = useCheck<VolumeCheck>({ ...selection, category, operation: "volume_aov" }, Boolean(exploration), localCheck);
  const states = useCheck<StateCheck>({ ...selection, category, operation: "state_orders" }, hasRegions && exploration?.detail === "states", localCheck);
  const products = exploration ? exploration.products : reportProducts;
  const showProducts = onShowProducts ?? setReportProducts;
  const result = volume.state.phase === "success" ? volume.state.result : null;
  const stateResult = states.state.phase === "success" && exploration?.detail !== "volume" ? states.state.result : null;
  const stateError = states.state.phase === "error" && exploration?.detail !== "volume" ? states.state.message : null;
  const showStates = exploration?.detail === "volume" ? onShowStates : undefined;
  let status = "待验证";
  let tone = "neutral";
  if (result?.status === "determined") {
    if (diagnostic) {
      status = result.driver === diagnostic.driver ? "数据支持" : "数据反驳";
      tone = result.driver === diagnostic.driver ? "positive" : "negative";
    } else if (result.driver) {
      status = `${driverNames[result.driver]}主导`;
    }
  } else if (result?.status === "mixed") {
    status = "证据混合";
  } else if (result?.status === "insufficient") {
    status = "数据不足";
  }

  return (
    <article className={`diagnostic-card${hasRegions ? "" : " no-regions"}`} aria-labelledby={title}>
      <div className="diagnostic-heading">
        <h3 id={title}>{localCheck ? category : categoryName(category)}</h3>
        <div className="diagnostic-actions">
          {(diagnostic || result) && <span className={`change-badge ${tone}`} aria-live="polite">{status}</span>}
          {hasProducts && <button className="secondary-button" onClick={() => showProducts({})}><Package size={15} />查看商品</button>}
        </div>
      </div>
      <p className="diagnostic-scope">{monthName(selection.month)}对比{shortMonth(previous)} · {basisName(selection.basis)}</p>
      {diagnostic && <>
        <p className="diagnostic-hypothesis">GMV {diagnostic.gmv_delta < 0 ? "下滑" : "增长"}是否由{driverNames[diagnostic.driver]}主导？</p>
        <p className="diagnostic-reason">{diagnostic.text}</p>
        <div className="evidence-links">{evidence}</div>
      </>}

      <div className="diagnostic-step" aria-busy={volume.state.phase === "loading"}>
        <div className="diagnostic-step-heading">
          <h4>{exploration ? "品类量价" : "验证品类量价"}</h4>
          {!result && (!exploration || volume.state.phase === "error") && <button className="secondary-button" disabled={volume.state.phase === "loading"} onClick={() => void volume.run()}>
            {volume.state.phase === "loading" ? <LoaderCircle size={15} className="spinner" /> : <ChartNoAxesCombined size={15} />}
            {volume.state.phase === "error" ? "重试量价验证" : volume.state.phase === "loading" ? "正在验证…" : "验证量价"}
          </button>}
        </div>
        {exploration && volume.state.phase === "loading" && <p className="check-note" role="status">正在计算量价…</p>}
        {volume.state.phase === "error" && <p className="check-error" role="alert">{volume.state.message}</p>}
        {result && <VolumeResult result={result} selection={selection} previous={previous} currency={currency} />}
      </div>

      {hasRegions && <div className="diagnostic-step" aria-busy={states.state.phase === "loading"}>
        <div className="diagnostic-step-heading">
          <h4>{localCheck ? "定位买家地区" : "定位买家州"}</h4>
          {!stateResult && <button className="secondary-button"
            disabled={(!result && !stateError) || (states.state.phase === "loading" && exploration?.detail !== "volume")}
            onClick={() => showStates ? showStates() : void states.run()}>
            {states.state.phase === "loading" ? <LoaderCircle size={15} className="spinner" /> : <MapPin size={15} />}
            {stateError ? (localCheck ? "重试地区排查" : "重试州级排查") : states.state.phase === "loading" && exploration?.detail !== "volume" ? "正在排查…" : localCheck ? "按地区排查订单变化" : "按州排查订单变化"}
          </button>}
        </div>
        {!result && !exploration && <p className="check-note">完成量价验证后，继续查看订单变化集中在哪些州。</p>}
        {stateError && <p className="check-error" role="alert">{stateError}</p>}
        {stateResult && <StateResult result={stateResult} daily={selection.basis === "daily"} volume={result}
          currency={currency} imported={Boolean(localCheck)} onProducts={hasProducts ? state => showProducts({ state }) : undefined} />}
        {stateResult && onViewReview && <a className="secondary-button diagnosis-review-link" href="#review" onClick={onViewReview}>
          <Sparkles size={15} />查看 AI 复盘
        </a>}
      </div>}
      {products && <ProductSection key={JSON.stringify(products.state ?? null)} selection={selection} category={category}
        scope={products} previous={previous} currency={currency} localCheck={localCheck} />}
      {!hasProducts && <p className="check-note product-section">补充商品 ID 或 SKU 后可查看商品明细。</p>}
    </article>
  );
}

export function MissingData() {
  return (
    <details className="methodology review-data-gap">
      <summary>待补数据<ChevronDown size={15} className="method-chevron" /></summary>
      <div className="method-content">
        <p><strong>库存排查</strong>需要商品 ID、仓库或可售地区、日期、可售库存和缺货时间。</p>
        <p><strong>促销排查</strong>需要商品 ID、活动起止日期、活动价或折扣、覆盖地区和参与订单。</p>
      </div>
    </details>
  );
}
