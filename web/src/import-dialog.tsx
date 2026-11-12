import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Download, FileUp, X } from "lucide-react";
import {
  amountField, coreFields, csvFields, csvFieldKeys, isSummaryReport, matchHeaders, readTable, suggestTable, validateCsv,
  type AmountScope, type CsvFile, type Mapping, type SourceSheet,
} from "./csv-import";
import { formatNumber } from "./data";
import { buildImportedData, type ImportedData } from "./imported-data";
import { readMerchantCsv, readMerchantExcel, type CsvEncoding } from "./merchant-file";

const maxFileBytes = 5 * 1024 * 1024;
const deliveredLabels = new Set([
  "delivered", "trade_finished", "已交付", "已送达", "已签收", "交易成功", "已完成", "订单已完成",
]);

function statuses(file: CsvFile | null, column: number | undefined) {
  if (!file || column === undefined) return [];
  return [...new Set(file.records.map(({ cells }) => cells[column]).filter(Boolean))];
}

function defaultStatuses(values: string[]) {
  return new Set(values.filter(value => deliveredLabels.has(value.toLowerCase())));
}

export function ImportDialog({ onClose, onImport }: { onClose: () => void; onImport: (data: ImportedData) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const fieldsPanel = useRef<HTMLDetailsElement>(null);
  const statusColumn = useRef<HTMLSelectElement>(null);
  const amountColumn = useRef<HTMLSelectElement>(null);
  const statusChoices = useRef<HTMLFieldSetElement>(null);
  const loadId = useRef(0);
  const [sheets, setSheets] = useState<SourceSheet[]>([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [header, setHeader] = useState(1);
  const [csvBytes, setCsvBytes] = useState<ArrayBuffer>();
  const [encoding, setEncoding] = useState<CsvEncoding>("auto");
  const [detectedEncoding, setDetectedEncoding] = useState("");
  const [filename, setFilename] = useState("");
  const [mapping, setMapping] = useState<Mapping>({});
  const [scope, setScope] = useState<AmountScope>("line");
  const [delivered, setDelivered] = useState(new Set<string>());
  const [currency, setCurrency] = useState("CNY");
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const [statusSearch, setStatusSearch] = useState("");
  const sheet = sheets[sheetIndex];
  const file = useMemo(() => sheet ? readTable(sheet, header) : null, [sheet, header]);
  const statusValues = useMemo(() => statuses(file, mapping.order_status), [file, mapping.order_status]);
  const visibleStatuses = statusValues.filter(value => value.toLowerCase().includes(statusSearch.trim().toLowerCase())).slice(0, 24);
  const validation = useMemo(() => file ? validateCsv(file, mapping, delivered, scope) : null, [file, mapping, delivered, scope]);
  const canImport = Boolean(validation && !validation.issues.length);
  const money = amountField(scope);
  const summaryReport = file !== null && isSummaryReport(file.headers, mapping);
  const needsStatusColumn = mapping.order_status === undefined;
  const recognizedOrder = mapping.order_id !== undefined && mapping.order_date !== undefined;
  const needsStatusChoice = !needsStatusColumn && delivered.size === 0 && statusValues.length > 0;
  const canSwitchToOrder = scope === "line" && mapping.line_amount === undefined && mapping.order_amount !== undefined;

  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal();
    return () => { loadId.current++; };
  }, []);

  function selectTable(source: SourceSheet[], index: number, line: number) {
    const next = readTable(source[index], line);
    const matched = matchHeaders(next.headers);
    setSheetIndex(index);
    setHeader(line);
    setMapping(matched);
    setScope(matched.line_amount === undefined && matched.order_amount !== undefined ? "order" : "line");
    setDelivered(defaultStatuses(statuses(next, matched.order_status)));
    setStatusSearch("");
  }

  function loadSheets(source: SourceSheet[]) {
    if (!source.some(sheet => sheet.rows.length)) throw new Error("文件没有可预览的记录。");
    const suggestion = suggestTable(source);
    setSheets(source);
    selectTable(source, suggestion.sheet, suggestion.header);
  }

  function loadCsv(bytes: ArrayBuffer, preference: CsvEncoding) {
    const csv = readMerchantCsv(bytes, preference);
    loadSheets([csv.sheet]);
    setDetectedEncoding(csv.encoding === "utf-8" ? "UTF-8" : "GB18030");
  }

  function changeEncoding(preference: CsvEncoding) {
    setEncoding(preference);
    setDetectedEncoding("");
    setError("");
    if (!csvBytes) return;
    try {
      loadCsv(csvBytes, preference);
    } catch (issue) {
      setSheets([]);
      setError(issue instanceof Error ? issue.message : "CSV 解码失败。");
    }
  }

  async function readFile(next: File) {
    const id = ++loadId.current;
    setSheets([]);
    setCsvBytes(undefined);
    setEncoding("auto");
    setDetectedEncoding("");
    setStatusSearch("");
    setError("");
    setFilename(next.name);
    setReading(true);
    try {
      if (!/\.(csv|xlsx)$/i.test(next.name)) throw new Error("请选择 .xlsx 或 .csv 文件。");
      if (next.size > maxFileBytes) throw new Error("文件超过 5 MB。");
      const bytes = await next.arrayBuffer();
      if (loadId.current !== id) return;
      if (/\.csv$/i.test(next.name)) {
        setCsvBytes(bytes);
        loadCsv(bytes, "auto");
      } else {
        const workbook = await readMerchantExcel(bytes);
        if (loadId.current === id) loadSheets(workbook);
      }
    } catch (issue) {
      if (loadId.current === id) setError(issue instanceof Error ? issue.message : "文件读取失败。");
    } finally {
      if (loadId.current === id) setReading(false);
    }
  }

  function mapField(field: keyof Mapping, value: string) {
    const index = value === "" ? undefined : Number(value);
    setMapping({ ...mapping, [field]: index });
    if (field === "order_status") {
      setStatusSearch("");
      setDelivered(defaultStatuses(statuses(file, index)));
    }
  }

  function focusStatusColumn() {
    if (fieldsPanel.current) fieldsPanel.current.open = true;
    statusColumn.current?.focus();
  }

  function columnOptions() {
    return <>
      <option value="">选择文件列</option>
      {file?.headers.map((name, index) => (
        <option key={index} value={index}>{name ? `${name}（第 ${index + 1} 列）` : `第 ${index + 1} 列（无标题）`}</option>
      ))}
    </>;
  }

  function submit() {
    if (!validation || !canImport) return;
    onImport(buildImportedData(filename, currency, validation.lines, scope));
  }

  return (
    <dialog ref={dialog} className="import-dialog" aria-labelledby="import-title" onCancel={event => { event.preventDefault(); onClose(); }}>
      <div className="import-heading">
        <div><h2 id="import-title">导入订单明细</h2><p>Excel 或 CSV · 最大 5 MB · 文件在当前浏览器处理</p></div>
        <button className="icon-button" aria-label="关闭导入" onClick={onClose}><X size={20} /></button>
      </div>
      <div className="import-body">
        <div className="import-file">
          <button className="secondary-button" onClick={() => picker.current?.click()}><FileUp size={17} />选择报表文件</button>
          <input ref={picker} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={event => {
            const next = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (next) void readFile(next);
          }} />
          <a className="secondary-button" href="/demo-orders.csv" download><Download size={15} />下载两个月样例</a>
        </div>
        {reading && <p className="check-note" role="status">正在读取报表…</p>}
        {(csvBytes || sheet) && <div className="import-source-controls">
          {csvBytes && <label>CSV 编码
            <select aria-label="CSV 编码" value={encoding} onChange={event => changeEncoding(event.target.value as CsvEncoding)}>
              <option value="auto">{detectedEncoding ? `自动 · ${detectedEncoding}` : "自动识别"}</option>
              <option value="utf-8">UTF-8</option><option value="gb18030">GB18030</option>
            </select>
          </label>}
          {!csvBytes && sheet && <label>工作表
            <select aria-label="工作表" value={sheetIndex} onChange={event => {
              const index = Number(event.target.value);
              const suggestion = suggestTable([sheets[index]]);
              selectTable(sheets, index, suggestion.header);
            }}>
              {sheets.map((entry, index) => <option key={entry.name} value={index}>{entry.name}</option>)}
            </select>
          </label>}
          {sheet && <label>表头所在行
            <input aria-label="表头所在行" type="number" min={1} value={header || ""} onChange={event => {
              const line = Number(event.target.value);
              if (Number.isInteger(line) && line >= 0) selectTable(sheets, sheetIndex, line);
            }} />
          </label>}
        </div>}
        {error && <p className="import-alert" role="alert">{error}</p>}
        {file && <>
          <div className="import-preview">
            <h3>核对识别结果</h3>
            <p>{filename} · {file.records.length.toLocaleString("zh-CN")} 条记录</p>
            <dl className="import-recognized">
              {coreFields.map(field => (
                <div key={field}><dt>{field === "order_id" ? "主订单号" : csvFields[field]}</dt>
                  <dd>{file.headers[mapping[field] ?? -1] || "待选择"}</dd></div>
              ))}
            </dl>
          </div>
          {recognizedOrder && needsStatusColumn && <div className="import-guidance" role="status">
            <p>文件已读取，已识别订单号和下单时间。请映射订单状态，确认哪些订单计入统计。</p>
            <button className="secondary-button" onClick={focusStatusColumn}>映射订单状态</button>
            <p>若原报表没有状态列，请换用含订单状态的报表。</p>
          </div>}
          {canSwitchToOrder && <div className="import-guidance" role="status">
            <p>已识别订单实付列。切换后按主订单汇总，并仍需确认纳入统计的状态。</p>
            <button className="secondary-button" onClick={() => {
              setScope("order");
              amountColumn.current?.focus();
            }}>切换到订单实付</button>
          </div>}
          <div className="import-source-controls">
            <label>金额口径<select aria-label="金额口径" value={scope} onChange={event => setScope(event.target.value as AmountScope)}>
              <option value="line">商品行金额</option><option value="order">订单实付</option>
            </select></label>
            <label>金额列<select ref={amountColumn} aria-label="金额列" value={mapping[money] ?? ""} onChange={event => mapField(money, event.target.value)}>
              {columnOptions()}
            </select></label>
            <label>文件币种<select aria-label="文件币种" value={currency} onChange={event => setCurrency(event.target.value)}>
              <option value="CNY">CNY · 人民币</option><option value="BRL">BRL · 巴西雷亚尔</option>
              <option value="USD">USD · 美元</option><option value="HKD">HKD · 港元</option><option value="EUR">EUR · 欧元</option>
            </select></label>
          </div>
          <p className="check-note">{scope === "line" ? "按商品行汇总所选金额，按主订单号去重计单。" : "按主订单汇总所选实付金额，每单计一次。"}</p>
          {needsStatusChoice && <div className="import-guidance" role="status">
            <p>请选择计入统计的订单状态。</p>
            <button className="secondary-button" onClick={() => {
              const fieldset = statusChoices.current;
              (fieldset?.querySelector<HTMLInputElement>('input[type="checkbox"]') ?? fieldset)?.focus();
            }}>选择纳入状态</button>
          </div>}
          {!needsStatusColumn && <fieldset className="import-status" ref={statusChoices} tabIndex={-1}>
            <legend>确认纳入统计的订单状态</legend>
            {statusValues.length > 24 && <input type="search" aria-label="筛选状态值" placeholder="筛选状态值"
              value={statusSearch} onChange={event => setStatusSearch(event.target.value)} />}
            {statusValues.length ? visibleStatuses.map(value => <label key={value}>
              <input type="checkbox" checked={delivered.has(value)} onChange={event => {
                const next = new Set(delivered);
                if (event.target.checked) next.add(value);
                else next.delete(value);
                setDelivered(next);
              }} />{value}
            </label>) : <p className="check-note">所选列没有可用的状态值，请检查原表或调整映射。</p>}
            {statusValues.length > 24 && <p className="check-note">共 {statusValues.length} 种状态，已选 {delivered.size} 种。</p>}
          </fieldset>}
          <details className="methodology import-adjust" ref={fieldsPanel}>
            <summary>调整字段<ChevronDown size={15} className="method-chevron" /></summary>
            <div className="method-content">
              <div className="mapping-grid">
                {(scope === "line" ? csvFieldKeys.filter(field => field !== "line_amount" && field !== "order_amount") : coreFields).map(field => (
                  <label key={field}>{csvFields[field]}{!coreFields.includes(field) && <small>选填</small>}
                    <select ref={field === "order_status" ? statusColumn : undefined}
                      aria-label={csvFields[field]} value={mapping[field] ?? ""} onChange={event => mapField(field, event.target.value)}>
                      {columnOptions()}
                    </select>
                  </label>
                ))}
              </div>
            </div>
          </details>
          <details className="methodology import-adjust">
            <summary>预览原始记录<ChevronDown size={15} className="method-chevron" /></summary>
            <div className="method-content table-scroll" role="region" aria-label="文件预览表" tabIndex={0}>
              <table className="check-table">
                <thead><tr><th scope="col">原始行</th>{file.headers.map((name, index) => <th scope="col" key={index}>{name || `第 ${index + 1} 列`}</th>)}</tr></thead>
                <tbody>{file.records.slice(0, 5).map(row => <tr key={row.line}>
                  <th scope="row">{row.line}</th>{file.headers.map((_, index) => <td key={index}>{row.paddedIds?.get(index) ?? row.cells[index] ?? "—"}</td>)}
                </tr>)}</tbody>
              </table>
            </div>
          </details>
          {validation && (validation.issues.length ? <div className="import-alert" role="alert">
            <strong>{summaryReport ? "文件看起来是汇总报表" : `发现 ${validation.issues.length} 个问题`}</strong>
            {summaryReport && <p>请重新导出包含主订单号、下单时间、订单状态和金额的订单明细。</p>}
            <ul>{validation.issues.slice(0, 10).map((issue, index) => <li key={index}>{issue}</li>)}</ul>
            {validation.issues.length > 10 && <p>另有 {validation.issues.length - 10} 个问题。</p>}
          </div> : <div className="import-ready" role="status">
            <strong>{validation.summary.includedRows.toLocaleString("zh-CN")} 行 · {validation.summary.orders.toLocaleString("zh-CN")} 单 · {formatNumber(validation.summary.cents / 100, 2)} {currency}</strong>
            <p>{validation.summary.first} 至 {validation.summary.last}</p>
          </div>)}
        </>}
      </div>
      <div className="import-footer">
        <button className="secondary-button" onClick={onClose}>取消</button>
        <button className="primary-button" disabled={!canImport} onClick={submit}>确认并导入</button>
      </div>
    </dialog>
  );
}
