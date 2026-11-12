import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity, ArrowDown, ArrowDownRight, ArrowRight, ArrowUpRight, BarChart3, CalendarDays,
  ChartNoAxesCombined, ChevronDown, CircleHelp, Database, FileUp, FlaskConical, Layers3, Link2,
  LoaderCircle, Package, ShoppingBag, Sparkles, Wallet,
} from "lucide-react";
import { BridgeChart, TrendChart } from "./charts";
import { DiagnosticCard, MissingData, type Diagnostic } from "./diagnostic-card";
import { ImportDialog } from "./import-dialog";
import type { ImportedData } from "./imported-data";
import {
  basisName, cases, categoryName, comparisonMonth, defaultMonth, formatNumber, hasCategory, monthName, monthly,
  percent, readView, shortMonth, signed, viewUrl,
  type Basis, type Category, type Comparison, type Selection, type View,
} from "./data";
import "./styles.css";

type Statement = { text: string; evidence: string[] };
type Report = Selection & {
  observations: Statement[];
  diagnostics: Diagnostic[];
  generated_at: string;
  model: string;
};
type ReviewState = { phase: "idle" } | { phase: "loading" } |
  { phase: "success"; report: Report } | { phase: "error"; message: string };
type Availability = "checking" | "available" | "unconfigured" | "offline";

const cards = [
  { id: "gmv", label: "成交金额 GMV", daily: "日均成交金额", icon: Wallet, unit: "BRL" },
  { id: "orders", label: "已交付订单", daily: "日均已交付订单", icon: ShoppingBag, unit: "单" },
  { id: "aov", label: "客单价", daily: "客单价", icon: Package, unit: "BRL / 单" },
] as const;

function direction(rate: number | null) {
  return rate === null || rate === 0 ? "neutral" : rate < 0 ? "negative" : "positive";
}

function CaseButton({ active, month, title, onClick }: {
  active: boolean; month: string; title: string; onClick: () => void;
}) {
  return (
    <button className={`case-button ${active ? "selected-case" : ""}`} aria-pressed={active} onClick={onClick}>
      <span className="case-dot" /><strong>{shortMonth(month)}</strong><span>{title}</span>
    </button>
  );
}

function CategoryList({ title, rows, gain, selected, onDiagnose, currency, imported, currentOnly = false }: {
  title: string; rows: Category[]; gain: boolean; selected?: string; onDiagnose: (category: string) => void;
  currency: string; imported: boolean; currentOnly?: boolean;
}) {
  const amount = (row: Category) => currentOnly ? row.current : row.delta;
  const largest = Math.max(1, ...rows.map(row => Math.abs(amount(row))));
  return (
    <section className={`category-list ${gain ? "positive" : "negative"}`} aria-label={title}>
      <h3>{currentOnly ? <BarChart3 size={17} /> : gain ? <ArrowUpRight size={17} /> : <ArrowDownRight size={17} />}{title}</h3>
      {rows.length === 0 && <p className="muted">当前周期没有对应的品类变化。</p>}
      {rows.map((row, index) => (
        <div className={`category-row evidence-target${selected === row.category ? " category-selected" : ""}`} key={row.category} id={`evidence-category:${row.category}`} tabIndex={-1}>
          <div className="category-top">
            <span className="category-name"><span className="rank">{String(index + 1).padStart(2, "0")}</span>{imported ? row.category : categoryName(row.category)}</span>
            <span className="category-amount">{currentOnly ? formatNumber(row.current, 2) : signed(row.delta)}<small> {currency}</small></span>
          </div>
          <div className="category-detail">
            <div className="category-track"><div style={{ width: `${Math.abs(amount(row)) / largest * 100}%` }} /></div>
            {!currentOnly && <span className="category-rate">{row.rate === null ? "新增" : percent(row.rate)}</span>}
            <button className="category-diagnose" aria-expanded={selected === row.category}
              aria-label={`查看诊断 · ${imported ? row.category : categoryName(row.category)}`} onClick={() => onDiagnose(row.category)}>
              查看诊断 <ArrowRight size={12} />
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}

function EvidenceLink({ id, comparison, basis }: { id: string; comparison: Comparison; basis: Basis }) {
  let label: string;
  if (id === "bridge") {
    label = "查看 GMV 拆解";
  } else if (id.startsWith("category:")) {
    const row = [...comparison.gainers, ...comparison.decliners].find(row => `category:${row.category}` === id);
    if (!row) return null;
    label = `${categoryName(row.category)} ${signed(row.delta)} BRL`;
  } else {
    const card = cards.find(card => card.id === id);
    if (!card) return null;
    const rate = comparison.metrics[card.id].rate;
    label = `${basis === "daily" ? card.daily : card.label}${rate === null ? "" : ` ${percent(rate)}`}`;
  }
  return (
    <a className="evidence-link" href={`#evidence-${encodeURIComponent(id)}`} onClick={event => {
      const target = document.getElementById(`evidence-${id}`);
      if (target) {
        event.preventDefault();
        target.focus({ preventScroll: true });
        target.scrollIntoView({ block: "center" });
      }
    }}>
      <Link2 size={13} />{label}
    </a>
  );
}

function ReviewSection({ state, availability, selection, comparison, onGenerate, onCheck }: {
  state: ReviewState;
  availability: Availability;
  selection: Selection;
  comparison: Comparison;
  onGenerate: () => void;
  onCheck: () => void;
}) {
  const loading = state.phase === "loading";
  const configured = availability === "available";
  return (
    <section id="review" className="panel review-panel evidence-target" aria-labelledby="review-title" tabIndex={-1}>
      <div className="review-header">
        <div className="review-title-block">
          <span className="section-icon ai-icon"><Sparkles size={22} /></span>
          <div>
            <div className="review-heading"><h2 id="review-title">AI 经营复盘</h2><span className="ai-badge">阿里云百炼</span></div>
            <p>基于 {monthName(selection.month)}{basisName(selection.basis)}数据，逐条验证品类假设并按州排查。</p>
          </div>
        </div>
        <button className="primary-button" onClick={onGenerate} disabled={!configured || loading}>
          {loading ? <LoaderCircle size={17} className="spinner" /> : <Sparkles size={17} />}
          {loading ? "正在生成…" : state.phase === "success" ? "重新生成" : "生成本月复盘"}
        </button>
      </div>
      <div className="review-body" aria-live="polite" aria-busy={loading}>
        {state.phase === "success" ? (
          <>
            <div className="report-meta"><span className="live-dot" /> 实时生成 <span>·</span> {state.report.model} <span>·</span> {new Date(state.report.generated_at).toLocaleString("zh-CN", { hour12: false })}</div>
            <section className="review-summary">
              <h3>数据结论</h3>
              {state.report.observations.map((statement, index) => (
                <div className="report-statement" key={index}>
                  <p>{statement.text}</p>
                  <div className="evidence-links" aria-label="查看依据">
                    {statement.evidence.map(id => <EvidenceLink key={id} id={id} comparison={comparison} basis={selection.basis} />)}
                  </div>
                </div>
              ))}
            </section>
            <div className="diagnostic-grid">
              {state.report.diagnostics.map(diagnostic => (
                <DiagnosticCard key={`${state.report.generated_at}:${diagnostic.category}`} diagnostic={diagnostic}
                  selection={selection} previous={cases[selection.month].previous}
                  evidence={<EvidenceLink id={`category:${diagnostic.category}`} comparison={comparison} basis={selection.basis} />}
                />
              ))}
            </div>
            <MissingData />
          </>
        ) : (
          <div className={`review-empty ${state.phase === "error" ? "review-error" : ""}`}>
            <span className="review-empty-icon">{loading ? <LoaderCircle size={23} className="spinner" /> : <FlaskConical size={23} />}</span>
            <div>
              <strong>{
                state.phase === "error" ? "本次复盘生成失败" : loading ? "正在请求百炼生成复盘" :
                  availability === "unconfigured" ? "实时复盘暂未开放" :
                  availability === "offline" ? "暂时无法连接复盘服务" :
                  availability === "checking" ? "正在检查复盘服务" : "准备好生成这段经营复盘"
              }</strong>
              <p>{
                state.phase === "error" ? state.message : loading ? "生成完成后，可以在报告里验证量价假设和查看买家州变化。" :
                  availability === "unconfigured" ? "你可以继续查看案例的量价、地区和商品诊断。" :
                  availability === "offline" ? "你可以继续浏览看板，稍后重新检查复盘服务。" :
                  availability === "checking" ? "看板和诊断图表可以继续浏览。" : "点击上方按钮，即可用当前选中的数据实时生成报告。"
              }</p>
            </div>
            {state.phase === "error" && <button className="secondary-button" onClick={onGenerate}>重试</button>}
            {state.phase === "idle" && (availability === "unconfigured" || availability === "offline") &&
              <button className="secondary-button" onClick={onCheck}>重新检查</button>}
          </div>
        )}
      </div>
    </section>
  );
}

function App() {
  const [view, setView] = useState(readView);
  const [imported, setImported] = useState<ImportedData | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [state, setState] = useState<ReviewState>({ phase: "idle" });
  const [availability, setAvailability] = useState<Availability>("checking");
  const [shareLabel, setShareLabel] = useState("复制视图链接");
  const [activeSection, setActiveSection] = useState("overview");
  const viewRef = useRef(view);
  const diagnosisPanel = useRef<HTMLDivElement>(null);
  const request = useRef<AbortController | null>(null);
  const shareTimer = useRef<number | undefined>(undefined);
  const { month, basis, diagnosis } = view;
  const selection = { month, basis };
  const sourceCases = imported?.cases ?? cases;
  const sourceMonths = imported?.months ?? monthly.slice(1);
  const currency = imported?.currency ?? "BRL";
  const orderOnly = imported?.scope === "order";
  const amountLabel = orderOnly ? "订单实付额" : "GMV";
  const caseData = sourceCases[month];
  const comparison = caseData[basis];
  const previous = caseData.previous;
  const hasPrevious = caseData.hasPrevious !== false;
  const { gmv, orders, aov } = comparison.metrics;
  const delta = gmv.current - gmv.previous;
  const hasBridge = hasPrevious && orders.previous > 0 && orders.current > 0;
  const primaryDriver = Math.abs(comparison.order_effect) >= Math.abs(comparison.aov_effect);
  const currentOnly = !hasPrevious || Boolean(imported && !comparison.decliners.length && comparison.gainers.every(row => Math.abs(row.delta) < 0.005));
  const firstCategory = (delta < 0 && !currentOnly ? comparison.decliners : comparison.gainers)[0];
  const leadRate = primaryDriver ? orders.rate : aov.rate;

  function applyView(next: View) {
    const current = viewRef.current;
    if (next.month !== current.month || next.basis !== current.basis) {
      request.current?.abort();
      request.current = null;
      setState({ phase: "idle" });
    }
    viewRef.current = next;
    setView(next);
  }

  function navigate(next: View) {
    if (!imported) {
      const url = viewUrl(next);
      if (next.diagnosis) {
        url.hash = "category-diagnosis";
      } else if (window.location.hash !== "#category-diagnosis") {
        url.hash = window.location.hash;
      }
      if (url.href !== window.location.href) window.history.pushState(null, "", url);
    }
    applyView(next);
  }

  function select(next: Selection) {
    if (next.month === month && next.basis === basis) return;
    const keepDiagnosis = next.month === month && diagnosis && hasCategory(next, diagnosis.category, sourceCases);
    navigate(keepDiagnosis ? { ...next, diagnosis } : next);
  }

  function focusDiagnosis() {
    diagnosisPanel.current?.focus({ preventScroll: true });
    diagnosisPanel.current?.scrollIntoView({ block: "start" });
  }

  function openDiagnosis(category: string) {
    if (diagnosis?.category === category) {
      focusDiagnosis();
      return;
    }
    navigate({ ...selection, diagnosis: { category, detail: "volume" } });
  }

  function switchData(data: ImportedData | null) {
    request.current?.abort();
    request.current = null;
    setState({ phase: "idle" });
    setImported(data);
    setImportOpen(false);
    setActiveSection("overview");
    applyView(data ? { month: data.defaultMonth, basis: "total" } : readView());
    window.scrollTo(0, 0);
  }

  useEffect(() => {
    if (diagnosis?.category) focusDiagnosis();
  }, [diagnosis?.category, month]);

  async function checkStatus() {
    setAvailability("checking");
    try {
      const response = await fetch("/api/status", { signal: AbortSignal.timeout(4000), cache: "no-store" });
      if (!response.ok) throw new Error("Unavailable");
      const result = await response.json();
      setAvailability(result.available === true ? "available" : "unconfigured");
    } catch {
      setAvailability("offline");
    }
  }

  useEffect(() => {
    if (imported) return;
    void checkStatus();
    const sync = () => applyView(readView());
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("popstate", sync);
      request.current?.abort();
      window.clearTimeout(shareTimer.current);
    };
  }, [imported]);

  async function generate() {
    if (imported || availability !== "available" || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setState({ phase: "loading" });
    try {
      const response = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selection),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(35000)]),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(typeof result?.detail === "string" ? result.detail : "复盘服务暂时不可用，请重试。");
      }
      if (result?.month !== month || result?.basis !== basis) {
        throw new Error("收到的复盘与当前分析范围不符，请重试。");
      }
      if (!Array.isArray(result.diagnostics)) throw new Error("收到的复盘缺少诊断信息，请重试。");
      if (request.current === controller) setState({ phase: "success", report: result });
    } catch (error) {
      if (request.current !== controller) return;
      setState({
        phase: "error",
        message: error instanceof DOMException && error.name === "TimeoutError"
          ? "等待时间过长，请稍后重试。"
          : error instanceof TypeError ? "连接复盘服务失败，请稍后重试。"
          : error instanceof Error ? error.message : "复盘生成失败，请重试。",
      });
    } finally {
      if (request.current === controller) request.current = null;
    }
  }

  async function copyLink() {
    const url = viewUrl(view);
    try {
      await navigator.clipboard.writeText(url.href);
      setShareLabel("链接已复制");
    } catch {
      window.history.replaceState(null, "", url);
      setShareLabel("可从地址栏复制");
    }
    window.clearTimeout(shareTimer.current);
    shareTimer.current = window.setTimeout(() => setShareLabel("复制视图链接"), 2200);
  }

  return (
    <>
      <a className="skip-link" href="#overview">跳到看板</a>
      <header className="site-header">
        <div className="topbar">
          <a className="brand" href="#overview" onClick={() => setActiveSection("overview")}>
            <span className="brand-icon"><Activity size={23} strokeWidth={2.4} /></span>
            <span>经营透镜<small>COMMERCE OPS</small></span>
          </a>
          <nav className="nav-links" aria-label="看板导航">
            <a className={activeSection === "overview" ? "active-nav" : ""} href="#overview" onClick={() => setActiveSection("overview")}>经营总览</a>
            <a className={activeSection === "diagnosis" ? "active-nav" : ""} href="#diagnosis" onClick={() => setActiveSection("diagnosis")}>
              {orderOnly ? "商品分析" : "品类诊断"}
            </a>
            {!imported && <a className={activeSection === "review" ? "active-nav" : ""} href="#review" onClick={() => setActiveSection("review")}><Sparkles size={14} />AI 复盘</a>}
          </nav>
          <span className="dataset-pill"><span className="live-dot" /> {imported ? "本地导入数据" : "Olist 公开数据"}</span>
        </div>
      </header>

      <main className="workspace" id="overview">
        <div className="page-heading">
          <div>
            <div className="eyebrow"><BarChart3 size={14} /> 经营分析工作台</div>
            <h1>电商经营诊断</h1>
            <p>{imported ? `${imported.filename} · ${currency} · ${orderOnly ? "订单总览" : "商品明细"}` : "从 GMV 波动定位品类变化，生成可追溯的经营复盘。"}</p>
          </div>
          <div className="page-actions">
            <button className="secondary-button" onClick={() => setImportOpen(true)}><FileUp size={16} />导入订单明细</button>
            {imported
              ? <button className="secondary-button" onClick={() => switchData(null)}>切回公开案例</button>
              : <button className="secondary-button share-button" onClick={() => void copyLink()}><Link2 size={16} /><span aria-live="polite">{shareLabel}</span></button>}
          </div>
        </div>

        <section className="filter-bar" aria-label="分析范围">
          {!imported && <div className="case-controls">
            <span className="control-caption"><Layers3 size={15} /> 案例</span>
            <CaseButton active={month === defaultMonth} month={defaultMonth} title="GMV 下滑" onClick={() => select({ month: defaultMonth, basis })} />
            <CaseButton active={month === comparisonMonth} month={comparisonMonth} title="量降额升" onClick={() => select({ month: comparisonMonth, basis })} />
          </div>}
          <div className="view-controls">
            <label className="month-picker">
              <CalendarDays size={16} />
              <select aria-label="分析月份" value={month} onChange={event => select({ month: event.target.value, basis })}>
                {Object.keys(sourceCases).map(value => <option key={value} value={value}>{monthName(value)}</option>)}
              </select>
              <ChevronDown size={14} className="picker-chevron" />
            </label>
            <div className="segmented" role="group" aria-label="统计口径">
              <button aria-pressed={basis === "total"} onClick={() => select({ month, basis: "total" })}>月度总量</button>
              <button aria-pressed={basis === "daily"} onClick={() => select({ month, basis: "daily" })}>日均</button>
            </div>
          </div>
        </section>

        <div className="insight">
          <span className="insight-icon"><ChartNoAxesCombined size={21} /></span>
          <div className="insight-copy">
            <span className="insight-label">本期关键发现</span>
            <p><strong>{shortMonth(month)}{basis === "daily" ? "日均 " : " "}{amountLabel} {gmv.rate === null
              ? `${formatNumber(gmv.current, 2)} ${currency}`
              : gmv.rate === 0 ? "环比持平" : `${gmv.rate < 0 ? "下降" : "上升"} ${formatNumber(Math.abs(gmv.rate) * 100, 2)}%`}</strong>
              {!hasPrevious ? <span className="insight-secondary">缺少上月数据</span>
                : hasBridge && delta !== 0 && leadRate !== null && <span className="insight-secondary">
                  {primaryDriver ? `${basis === "daily" ? "日均" : ""}订单量` : "客单价"} {percent(leadRate)}，是 {amountLabel} 变化的主要贡献项
                </span>}
            </p>
          </div>
          {firstCategory && <button className="insight-link" onClick={() => openDiagnosis(firstCategory.category)}>
            {currentOnly ? "查看本月品类" : `排查 ${shortMonth(month)} GMV ${delta < 0 ? "下滑" : delta > 0 ? "增长" : "品类波动"}`} <ArrowRight size={16} />
          </button>}
        </div>

        <div className="metric-grid" aria-label="核心经营指标">
          {cards.map(card => {
            const metric = comparison.metrics[card.id];
            const Icon = card.icon;
            const decimals = card.id === "gmv" || card.id === "aov" || basis === "daily" ? 2 : 0;
            return (
              <article className="panel metric-card evidence-target" id={`evidence-${card.id}`} key={card.id} tabIndex={-1}>
                <div className="metric-label"><span className="metric-icon"><Icon size={17} /></span>
                  {orderOnly && card.id === "gmv" ? `${basis === "daily" ? "日均" : ""}${amountLabel}` : basis === "daily" ? card.daily : card.label}
                </div>
                <div className="metric-value">{card.id === "aov" && orders.current === 0 ? "—" : formatNumber(metric.current, decimals)}
                  <span>{card.id === "orders" ? card.unit : card.id === "aov" ? `${currency} / 单` : currency}</span></div>
                <div className="metric-compare">
                  {metric.rate === null ? <span>{hasPrevious ? "环比 —" : "缺少上月数据"}</span> : <>
                    <span className={`change-badge ${direction(metric.rate)}`}>{metric.rate < 0 ? <ArrowDownRight size={14} /> : <ArrowUpRight size={14} />}{percent(metric.rate)}</span>
                    <span>较 {shortMonth(previous)}</span>
                  </>}
                </div>
              </article>
            );
          })}
        </div>

        <div className="analysis-grid">
          <section className="panel chart-panel" aria-labelledby="trend-title">
            <div className="panel-heading">
              <div><h2 id="trend-title">{amountLabel}趋势</h2><p>{orderOnly ? "点击月份查看订单指标" : imported ? "点击月份联动诊断" : "2018 年 1–7 月 · 点击月份联动诊断"}</p></div>
              <span className="chart-unit"><span />{basis === "daily" ? "日均 " : ""}{currency}</span>
            </div>
            <TrendChart month={month} basis={basis} records={sourceMonths} currency={currency} imported={Boolean(imported)} amountLabel={amountLabel}
              onSelect={nextMonth => select({ month: nextMonth, basis })} />
          </section>
          <section className="panel chart-panel evidence-target" id="evidence-bridge" tabIndex={-1} aria-labelledby="bridge-title">
            <div className="panel-heading">
              <div><h2 id="bridge-title">{amountLabel}变化拆解</h2>{hasPrevious && <p>{shortMonth(previous)} → {shortMonth(month)} · 订单量 × 客单价</p>}</div>
              {hasPrevious && <span className={`change-badge bridge-change ${direction(delta)}`}>{signed(delta)} {currency}</span>}
            </div>
            {hasBridge ? <BridgeChart comparison={comparison} basis={basis} currency={currency} imported={Boolean(imported)} amountLabel={amountLabel} />
              : <p className="check-note">{hasPrevious ? "比较期内至少一个月没有已交付订单，无法拆解量价贡献。" : "缺少上月数据，当前显示本月指标。"}</p>}
          </section>
        </div>

        {orderOnly ? <section className="panel diagnosis-panel" id="diagnosis" aria-labelledby="diagnosis-title">
          <h2 id="diagnosis-title">商品分析</h2>
          <p className="check-note">当前按主订单统计实付额。导入包含商品行金额和商品 ID 或 SKU 的明细后，即可下钻。</p>
        </section> : <section className="panel diagnosis-panel" id="diagnosis" aria-labelledby="diagnosis-title">
          <div className="panel-heading">
            <div><h2 id="diagnosis-title">{currentOnly ? "品类表现" : "品类变化"}</h2>
              <p>{currentOnly ? `${shortMonth(month)} · 按本月 ${basis === "daily" ? "日均 " : ""}GMV 排序`
                : `${shortMonth(month)}对比${shortMonth(previous)} · 按 ${basis === "daily" ? "日均 " : ""}GMV 变化金额排序`}</p>
            </div>
            <span className="small-tag">{currentOnly ? "Top 5" : "涨跌各 Top 5"}</span>
          </div>
          <div className={`category-grid${currentOnly ? " category-single" : ""}`}>
            {!currentOnly && <CategoryList title="下滑品类" rows={comparison.decliners} gain={false} selected={diagnosis?.category}
              onDiagnose={openDiagnosis} currency={currency} imported={Boolean(imported)} />}
            <CategoryList title={currentOnly ? "本月品类" : "增长品类"} rows={comparison.gainers} gain selected={diagnosis?.category}
              onDiagnose={openDiagnosis} currency={currency} imported={Boolean(imported)} currentOnly={currentOnly} />
          </div>
          {diagnosis && <div className="category-diagnosis" id="category-diagnosis" ref={diagnosisPanel} tabIndex={-1}
            role="region" aria-label={`${imported ? diagnosis.category : categoryName(diagnosis.category)}品类诊断`}>
            <DiagnosticCard key={`${month}:${basis}:${diagnosis.category}`} selection={selection} previous={previous}
              exploration={diagnosis} currency={currency} localCheck={imported?.check} hasRegions={imported?.hasRegions} hasProducts={imported?.hasProducts}
              onViewReview={imported ? undefined : () => setActiveSection("review")}
              onShowProducts={products => navigate({ ...selection, diagnosis: { ...diagnosis, products } })}
              onShowStates={() => navigate({ ...selection, diagnosis: { ...diagnosis, detail: "states" } })} />
          </div>}
        </section>}

        {!imported && <ReviewSection state={state} availability={availability} selection={selection} comparison={comparison}
          onGenerate={() => void generate()} onCheck={() => void checkStatus()} />}

        <details className="methodology">
          <summary><CircleHelp size={17} />指标口径与数据说明<ChevronDown size={16} className="method-chevron" /></summary>
          <div className="method-content">
            <p><strong>{amountLabel}</strong>{orderOnly ? `同一主订单的实付只汇总一次，币种为 ${currency}。` : imported ? `按下单月份汇总已交付明细的行金额，币种为 ${currency}。` : "按下单月份统计已交付订单的商品金额与运费，货币为巴西雷亚尔（BRL）。"}客单价等于金额合计除以去重订单量。</p>
            <p><strong>环比与拆解</strong>以紧邻上月为基准。日均按各月自然日数计算，客单价口径保持一致。先按上月客单价计算订单量影响，再按本月订单量计算客单价影响。</p>
            {!orderOnly && <p><strong>分析范围</strong>{imported ? "订单按当前品类或商品范围去重。同一订单可包含多个品类或商品，各行订单数不能直接相加。" : "品类贡献使用商品明细中的含运费金额。Olist 交易数据可以帮助定位波动，经营假设需要结合后续业务资料验证。"}</p>}
          </div>
        </details>
        <footer className="footer">
          <span><Database size={14} /> 数据来源 {imported ? imported.filename : <>
            <a href="https://www.kaggle.com/datasets/olistbr/brazilian-ecommerce" target="_blank" rel="noreferrer">Olist Brazilian E-Commerce</a> · 已交付订单聚合 · <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="noreferrer">CC BY-NC-SA 4.0</a>
          </>}</span>
          <a href="#overview">回到顶部 <ArrowDown size={14} className="back-top-icon" /></a>
        </footer>
      </main>
      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} onImport={switchData} />}
    </>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
