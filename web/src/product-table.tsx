import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatNumber, signed, type Basis } from "./data";
import type { ProductCheck } from "./diagnostic-data";

const pageSize = 10;
type Filter = "all" | "previous" | "current";

export function ProductTable({ result, currency, basis, imported }: {
  result: ProductCheck; currency: string; basis: Basis; imported: boolean;
}) {
  const [descending, setDescending] = useState(result.gmv_delta !== null && result.gmv_delta > 0);
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(1);
  const hasBaseline = result.gmv_delta !== null;
  const rows = useMemo(() => result.rows.filter(row => {
    if (filter === "previous") return (row.previous_orders ?? 0) > 0 && row.current_orders === 0;
    if (filter === "current") return row.previous_orders === 0 && row.current_orders > 0;
    return true;
  }).sort((left, right) => {
    const change = hasBaseline
      ? (descending ? -1 : 1) * ((left.gmv_delta ?? 0) - (right.gmv_delta ?? 0))
      : right.current_gmv - left.current_gmv;
    return change || left.product.localeCompare(right.product);
  }), [result, filter, descending, hasBaseline]);
  const last = Math.max(1, Math.ceil(rows.length / pageSize));
  const orderDigits = basis === "daily" ? 2 : 0;
  const number = (value: number | null, digits: number) => value === null ? "—" : formatNumber(value, digits);
  return (
    <>
      <div className="product-controls">
        {hasBaseline && <>
          <label>排序<select aria-label="排序" value={descending ? "gain" : "loss"} onChange={event => {
            setDescending(event.target.value === "gain");
            setPage(1);
          }}><option value="loss">GMV 降幅</option><option value="gain">GMV 增幅</option></select></label>
          <label>成交范围<select aria-label="成交范围" value={filter} onChange={event => {
            setFilter(event.target.value as Filter);
            setPage(1);
          }}><option value="all">全部商品</option><option value="previous">仅上期有成交</option><option value="current">仅本期有成交</option></select></label>
        </>}
        <span className="check-note">{rows.length} 个商品{!hasBaseline && " · 缺少上月数据，按本月 GMV 排序"}</span>
      </div>
      {rows.length ? <>
        <div className="table-scroll" role="region" aria-label="商品对比表" tabIndex={0}>
          <table className="check-table product-table">
            <thead><tr>
              <th scope="col">商品</th>
              <th scope="col">GMV（{currency}）<small>{hasBaseline ? "上期 → 本期" : "本期"}</small></th>
              <th scope="col">去重订单数<small>{hasBaseline ? "上期 → 本期" : "本期"}</small></th>
              <th scope="col">GMV 差额</th>
            </tr></thead>
            <tbody>{rows.slice((page - 1) * pageSize, page * pageSize).map(row => (
              <tr key={row.product}>
                <th scope="row" title={row.product}>{imported ? row.name ?? row.product : `商品 ${row.product.slice(0, 8)}`}
                  {imported && row.name && <small>{row.product}</small>}
                </th>
                <td>{hasBaseline && <><span className="product-previous">{number(row.previous_gmv, 2)}</span>
                  <span className="product-arrow"> → </span></>}<strong className="product-current">{number(row.current_gmv, 2)}</strong></td>
                <td>{hasBaseline && <><span className="product-previous">{number(row.previous_orders, orderDigits)}</span>
                  <span className="product-arrow"> → </span></>}<strong className="product-current">{number(row.current_orders, orderDigits)}</strong></td>
                <td className={row.gmv_delta === null || row.gmv_delta === 0 ? "" : row.gmv_delta < 0 ? "loss-text" : "gain-text"}>
                  {row.gmv_delta === null ? "—" : signed(row.gmv_delta)}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <div className="product-pagination" aria-label="商品分页">
          <button className="icon-button" aria-label="上一页" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft size={17} /></button>
          <span aria-live="polite">{page} / {last}</span>
          <button className="icon-button" aria-label="下一页" disabled={page >= last} onClick={() => setPage(page + 1)}><ChevronRight size={17} /></button>
        </div>
      </> : <p className="check-note">当前范围内没有符合筛选条件的商品。</p>}
    </>
  );
}
