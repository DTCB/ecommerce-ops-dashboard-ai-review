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

请使用 Python 3.10+ 环境运行项目。

```powershell
python -m pip install -r requirements.txt
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
