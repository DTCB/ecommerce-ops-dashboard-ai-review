# 电商运营数据分析看板 + AI复盘助手

面向数据分析、运营数据分析、产品运营实习岗位的业务型项目。项目围绕 Olist 公开电商数据，完整实现数据导入、清洗建模、指标体系、经营诊断、异常识别、AI/模板双模式复盘，避免停留在普通 Streamlit 玩具 Demo。

## 项目亮点

- 建立订单、商品、用户三层业务宽表，沉淀可解释的电商经营指标体系。
- 默认使用已交付订单计算 GMV、订单量、客单价、复购率、留存、品类贡献等核心指标。
- Olist 没有曝光/访问数据，因此不虚构访问转化率，改用履约率、取消率、复购率、留存和体验指标做经营诊断。
- AI 复盘支持 OpenAI 兼容接口；未配置 Key 或接口失败时自动降级为模板复盘，保证离线演示稳定。
- 同步提供 README、项目复盘、截图清单和测试说明，便于项目维护与公开展示。

## 技术栈

- Python / Pandas / SQLite
- Streamlit / Plotly
- OpenAI-compatible Chat Completions API
- Pytest

## 数据来源

优先使用 [Olist Brazilian E-Commerce Public Dataset](https://www.kaggle.com/datasets/olistbr/brazilian-ecommerce)。

下载并解压后，将以下 CSV 放入 `data/raw/`：

- `olist_orders_dataset.csv`
- `olist_order_items_dataset.csv`
- `olist_order_payments_dataset.csv`
- `olist_order_reviews_dataset.csv`
- `olist_customers_dataset.csv`
- `olist_products_dataset.csv`
- `olist_sellers_dataset.csv`
- `product_category_name_translation.csv`

`olist_geolocation_dataset.csv` 首版可选，不作为核心指标依赖。

## 项目结构

```text
.
├── app.py
├── src/
│   ├── data_loader.py
│   ├── metrics.py
│   ├── anomaly.py
│   ├── report.py
│   ├── llm_client.py
│   ├── database.py
│   └── sample_data.py
├── scripts/
│   └── build_database.py
├── data/
│   ├── raw/
│   └── processed/
├── docs/
├── tests/
├── requirements.txt
└── .env.example
```

## 运行方式

### 经营透镜网站 Demo

需要 Node.js 24 和 Python 3.11 或以上。内置看板使用 [Olist 公开数据](https://www.kaggle.com/datasets/olistbr/brazilian-ecommerce) 的已交付订单聚合结果。演示数据按月份、品类、买家州和商品汇总，商品编号经过脱敏，采用 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)。

在第一个 PowerShell 窗口启动 API：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-local.txt
.\.venv\Scripts\python.exe -m uvicorn api.index:app --host 127.0.0.1 --port 8001
```

在另一个 PowerShell 窗口启动前端：

```powershell
npm.cmd ci
npm.cmd run dev
```

打开 [本地看板](http://127.0.0.1:5174/) 或 [4 月对照案例](http://127.0.0.1:5174/?month=2018-04&basis=total)。执行 `npm.cmd run build` 进行类型检查并生成 `dist/`。

要启用实时复盘，在项目根目录创建 Git 忽略的 `.env.local`，填写新密钥和百炼控制台给出的 OpenAI 兼容 Base URL。Base URL 以 `/compatible-mode/v1` 结尾。模型缺省为 `qwen3.8-flash`。

```dotenv
LLM_API_KEY=
LLM_BASE_URL=
LLM_MODEL=qwen3.8-flash
```

保存后，在「AI 经营复盘」点「重新检查」再生成。如果未创建 `.env.local`，网站也可以读取现有 `.env` 中的百炼配置。下面的 Streamlit 继续使用 `.env`。

从首屏或涨跌榜打开品类诊断，再点「按州排查订单变化」。复制视图链接可以分享当前品类和诊断层级。生成 AI 复盘后，也可以在报告内逐条验证假设。量价和州级结果从聚合数据计算。品类订单数按订单号去重，品类客单价用该品类 GMV 除以包含该品类的订单数。

在品类面板或州级表格点「查看商品」，可以比较两期商品 GMV 和订单数，并按只在一期有成交的商品筛选。

「导入订单明细」支持最多 5 MB 的 Excel（.xlsx）和 UTF-8、GB18030 CSV。导入页会推荐工作表与表头行，自动匹配常见中文字段，并显示可调整的金额列、订单状态和币种。商品行金额可用于品类和商品分析，订单实付按主订单去重汇总。文件在当前浏览器标签页处理，刷新后回到支持实时 AI 复盘的公开案例。

需要重建网站的数据文件时，先通过 `python scripts/build_database.py` 构建 SQLite，再执行 `python scripts/export_demo_data.py`。导出的 JSON 提供看板指标及品类、买家州和商品的聚合数据。

### Vercel 部署

在 Vercel Hobby 导入本仓库，根目录选择仓库根目录，Production Branch 设为 `main`。Vite、同域 FastAPI 路由和香港函数区域由 `vercel.json` 配置，Python 固定为 3.12。先在 PR 的 Preview 验收 6 月量价、州级和商品下钻、分享链接及合成报表导入，再合并并在项目的固定网址复测。

Preview 可浏览案例和导入报表。Production 默认提供同样体验，只有确认百炼预算并验证 Redis 额度后，才在 Production 设置以下变量并重新部署。

| 变量 | 用途 |
| --- | --- |
| `LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL` | 电商 Demo 的专用百炼凭据、兼容接口地址和模型名 |
| `UPSTASH_REDIS_REST_URL`、`UPSTASH_REDIS_REST_TOKEN` | 可写的 Upstash Redis REST 凭据 |
| `QUOTA_HASH_SECRET` | 独立生成的随机密钥，用于散列公网 IP |
| `AI_BUDGET_CONFIRMED` | 初始为 `0`，百炼已设预算告警和达额停用、Redis 已验证后设为 `1` |

`GET /api/status` 可检查复盘是否开放。启用后用新公网出口实测 6 月和 4 月复盘，同一出口第 4 次应返回 `429`。每公网 IP 每日 3 次，全站每月 200 次，按 UTC 重置。需要暂停 AI 时把开关改回 `0` 后重新部署，紧急时停用专用 Key。整站故障可使用 Vercel 的上一生产部署回滚，修复后恢复自动分配生产域名。

### Streamlit

请使用 Python 3.10+ 环境运行项目。

```powershell
python -m pip install -r requirements-local.txt
python -m streamlit run app.py
```

可选：先把 Olist CSV 建模为 SQLite。

```powershell
python scripts/build_database.py
```

无 Olist 数据时，应用会自动提供演示样例数据，便于先查看页面与复盘能力。

## LLM 配置

复制 `.env.example` 为 `.env`，或在终端设置环境变量：

```powershell
$env:LLM_API_KEY="你的 API Key"
$env:LLM_BASE_URL="https://api.openai.com/v1"
$env:LLM_MODEL="gpt-4o-mini"
```

也可接入 DeepSeek、通义等兼容 Chat Completions 的服务，只需替换 `LLM_BASE_URL` 与 `LLM_MODEL`。

## 指标口径

- GMV：默认使用已交付订单，支持“商品金额 GMV”和“含运费 GMV”切换。
- 订单量：默认已交付订单数，经营诊断页另展示取消/不可用订单。
- 客单价：GMV / 已交付订单数。
- 复购率：购买次数大于等于 2 的 `customer_unique_id` 占比。
- 留存：按用户首购月份做 cohort，观察后续月份是否再次下单。
- 品类贡献：按英文品类统计 GMV、订单量、客单价、平均评分。
- 履约体验：交付天数、延迟天数、延迟订单占比、评分关系。

## 看板页面

- 总览：GMV、订单量、客单价、复购率、取消率、平均评分、月度趋势。
- 经营诊断：GMV 异常波动、Top 下滑品类、订单状态分布。
- 品类与商品：品类 GMV 排行、订单贡献、价格带、评分。
- 用户与地域：州/地区表现、新老客、复购、cohort 留存。
- 履约与体验：交付周期、延迟订单、支付结构、评分关系。
- AI复盘：日报/周报/月报，AI 生成与模板兜底，支持 Markdown 下载。

## 测试

```powershell
python -m pytest
```

测试覆盖原始数据缺失提示、取消订单排除、GMV/客单价/复购率、cohort 留存等核心口径。

## 可改进方向

- 增加真实地理可视化，将 `olist_geolocation_dataset.csv` 纳入城市/州级地图。
- 增加 Excel 导出、复盘归档和截图自动生成。
- 将 Streamlit 单体应用升级为 FastAPI + React，用于更强工程化展示。
- 追加商品标题/评价文本分析，扩展到评论主题和 BadCase 识别。
