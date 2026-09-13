# Machina

Machina là **cross-merchant Product Intelligence Gateway**: một shopping agent gửi yêu cầu
tự nhiên qua MCP, hệ thống chuẩn hóa yêu cầu, tìm và xếp hạng các offer từ catalogue của
nhiều merchant, sau đó trả về các kết quả có bằng chứng và lý do có thể kiểm chứng.

Toàn bộ merchant, sản phẩm, giá, review và hình ảnh trong repository là **dữ liệu tổng hợp
phục vụ demo và kiểm thử**, không phải dữ liệu thương mại thực tế.

## 1. Mô tả hệ thống

Machina cung cấp hai góc nhìn trên cùng một cơ sở dữ liệu:

- **MCP/Buyer-agent view:** chỉ trả về dữ kiện đã được merchant phê duyệt và được phép hiển thị cho agent.
- **Merchant dashboard view:** hiển thị đầy đủ dữ kiện, evidence, approval queue, nhu cầu tìm kiếm và catalogue gaps cho merchant đang được chọn.

Lớp kiểm soát disclosure `CONTROL` có ba mức:

- `AGENT_VISIBLE`: dữ kiện, evidence và trạng thái match được phép trả cho agent.
- `MATCHING_ONLY`: dữ kiện được dùng để xếp hạng nội bộ nhưng bị trả về là `UNKNOWN` và không xuất hiện trong `decision_factors`.
- `INTERNAL_ONLY`: không tham gia matching và không xuất hiện trong response của agent.

## 2. Kiến trúc

```text
AI shopping agent
        |
        | MCP over stdio
        v
mcp/server
        |
        v
packages/core
  - vertical classification
  - buyer-language normalization
  - evidence/disclosure policy
  - hybrid retrieval and deterministic ranking
  - suitability and draft offer
        |
        +------------------+
        v                  v
packages/database     packages/schemas
  SQLite models       Zod I/O schemas,
  and audit logs      ontology and repo paths
        |
        v
machina.db + data/jsonl + data/assets

Merchant browser
        |
        v
apps/dashboard (Next.js)
        |
        +--> core/database/retrieval
```

### Các package và ứng dụng

- `mcp/server`: MCP server dùng `@modelcontextprotocol/sdk`, giao tiếp qua stdio và đăng ký bốn tool cho AI agent.
- `apps/dashboard`: merchant UI bằng Next.js; có merchant switcher, dashboard nhu cầu, catalogue gaps, approval và Validation Lab report.
- `packages/core`: logic nghiệp vụ chính. LLM chỉ xử lý phân loại, chuẩn hóa, trích xuất và diễn đạt lý do; LLM không quyết định thứ tự ranking.
- `packages/database`: kết nối SQLite, khởi tạo schema, seed dữ liệu và các model truy cập merchants, catalogue, facts, evidence, search log, offer và experiment.
- `packages/schemas`: Zod schemas cho MCP I/O, status, ontology và cơ chế tìm repository root.
- `packages/retrieval`: benchmark embedding baseline/enriched và xây dựng Validation Lab report.
- `data`: schema SQL, ontology theo vertical, dữ liệu JSON/JSONL, contracts và hình ảnh WebP.

### Luồng tìm kiếm và ranking

Với kết nối mặc định, hệ thống thực hiện:

1. Phân loại vertical từ `request_text`. Kết nối đã scope theo vertical hoặc merchant sẽ bỏ qua bước này.
2. Chuẩn hóa ngôn ngữ người mua thành các requirement theo ontology của vertical.
3. Loại offer hết hàng/không giao được, rồi áp dụng hard filters: giá, currency, availability, thời gian giao tối đa và merchant nếu có.
4. Loại sản phẩm có evidence xác nhận không phù hợp; tính semantic similarity bằng embedding.
5. **Stage A:** ưu tiên số lượng requirement được verified match.
6. **Stage B:** trong cùng bucket, tính utility từ relevance, giá, trust và fulfillment.
7. Áp dụng merchant diversity cap mặc định là 2 sản phẩm/merchant.
8. Tạo `decision_factors`, badge và status sau khi áp dụng disclosure policy.
9. Dùng LLM để diễn đạt lý do từ các factor đã có; nếu LLM lỗi thì dùng template xác định.
10. Ghi search, kết quả và feature vector của mọi candidate sống sót vào audit tables.

Thứ tự kết quả là deterministic với cùng input và dữ liệu. Không có LLM nào quyết định ranking.

### Scoring strategy

Chi tiết thiết kế scoring được ghi tại [`scoring_stategy.md`](scoring_stategy.md). Các default
đang được triển khai trong `packages/core/src/matchingCore.ts` là:

| Thành phần | Trọng số |
|---|---:|
| Relevance | 40% |
| Price | 25% |
| Trust | 20% |
| Fulfillment | 15% |

Relevance kết hợp attribute matching và semantic similarity theo tỷ lệ 60/40. Fulfillment
kết hợp tốc độ giao hàng và phí ship theo tỷ lệ 70/30. `delivery_days_max` là hard filter
trước khi scoring; giá, giao hàng và phí ship được chuẩn hóa theo candidate pool. Trust dùng
`average_rating` và số lượng review với điều chỉnh logarithmic. Stage A (`verifiedCount`)
luôn được áp dụng trước Stage B.

## 3. MCP API

MCP server mặc định dùng database scope toàn cục. Có thể thu hẹp scope bằng biến môi trường
`MACHINA_VERTICAL` hoặc `MACHINA_MERCHANT_ID`.

### `search_products`

Nhận `request_text`, tuỳ chọn `filters.price_max`, `filters.currency`, `filters.availability`, `filters.delivery_days_max`,
`merchant_id`, `max_results` và `client.name`.

Trả về request status: `VERIFIED`, `PARTIAL`, `INSUFFICIENT_DATA`, `NO_MATCH` hoặc
`CLARIFICATION_REQUIRED`. Mỗi product có merchant, giá, requirement status,
`decision_factors`, badge và reason. `UNKNOWN` có nghĩa là chưa có evidence được phê duyệt,
không phải là non-match.

### `get_product_details`

Nhận `product_id`, trả về title, offer, merchant identity, các attribute `AGENT_VISIBLE`,
provenance evidence, review highlights và primary image dạng MCP image content block (base64).

### `check_suitability`

Nhận `product_id`, `attribute`, `requested_value`; trả về một trong:
`SUITABLE`, `NOT_SUITABLE`, `INSUFFICIENT_DATA`.

### `create_offer`

Nhận `product_id` và `quantity`, tạo một draft offer không ràng buộc. Đây không phải checkout,
không thanh toán và không gọi hệ thống bên ngoài.

## 4. Công nghệ và API sử dụng

- TypeScript 5.5, Node.js và npm workspaces.
- Next.js 16, React 19, Tailwind CSS 3 cho merchant dashboard.
- SQLite thông qua `better-sqlite3`.
- MCP SDK `@modelcontextprotocol/sdk` với `StdioServerTransport`.
- Zod 4 cho validation schema và structured I/O.
- OpenAI Node SDK cho các bước LLM và embeddings.
- Chat model: `gpt-4o-mini`.
- Embedding model: `text-embedding-3-small`.
- Vitest cho unit tests; `tsx` để chạy TypeScript scripts trực tiếp.
- PostgreSQL, payment gateway hoặc merchant API bên ngoài chưa được sử dụng trong MVP này.

## 5. Yêu cầu môi trường

- Node.js tương thích với các package trong `package-lock.json`.
- npm.
- OpenAI API key cho live search, vertical classification, buyer-language normalization, evidence extraction, reason generation và benchmark embeddings.
- Không cần API key để chạy unit tests; dashboard vẫn mở được với catalogue đã seed, nhưng các thao tác cần LLM sẽ không hoạt động đầy đủ.

## 6. Cài đặt

```bash
git clone <repository-url>
cd machina-shopping-agent
npm install
```

Tạo file `.env` ở root:

```env
OPENAI_API_KEY=sk-...
```

Không commit `.env`. Có thể bắt đầu từ `.env.example`.

Khởi tạo database và nạp dataset tổng hợp:

```bash
npm run db:init
npm run db:seed
```

`db:init` tạo `machina.db` từ `data/schema.sql` và thêm các bảng riêng cho benchmark,
ranking impressions và ranking actions. `db:seed` nạp dữ liệu từ `data/jsonl` theo đúng thứ
tự dependency của foreign key và có tính idempotent.

## 7. Chạy hệ thống

### Merchant dashboard

```bash
npm run dev:dashboard
```

Mở `http://localhost:3000`. Dashboard hỗ trợ:

- `/`: catalogue size, demand từ agent searches, catalogue gaps và approval queue.
- `/approval`: xem evidence proposals, approve/reject và chọn visibility tier.
- `/report`: freeze held-out set, chạy baseline/enriched benchmark và xem report.

Dashboard dùng query parameter `?merchant=<merchant_id>` để chuyển merchant hiện tại.

### MCP server độc lập

```bash
npm run mcp:server
```

Server chạy qua stdio, phù hợp để kết nối từ MCP-capable agent. File `.mcp.json` đã có sẵn cấu hình:

```json
{
  "mcpServers": {
    "machina": {
      "command": "npx",
      "args": ["tsx", "mcp/server/src/index.ts"],
      "env": {}
    }
  }
}
```

Để giới hạn scope khi chạy thủ công:

```powershell
$env:MACHINA_VERTICAL = "running_shoes"
npm run mcp:server
```

Hoặc:

```powershell
$env:MACHINA_MERCHANT_ID = "M01"
npm run mcp:server
```

`MACHINA_MERCHANT_ID` là scope hẹp nhất. Nếu đồng thời đặt cả hai biến, vertical phải khớp
với vertical của merchant.

### Database path tuỳ chọn

Mặc định database là `machina.db` ở repository root. Test hoặc script riêng có thể dùng:

```powershell
$env:MACHINA_DB_PATH = "C:\temp\machina-test.db"
```

## 8. Kiểm thử và type checking

```bash
npm run typecheck
npm test
```

Unit tests bao phủ matching core, evidence tri-state, disclosure policy và gap classification;
các LLM call trong test được mock nên không cần API key.

Smoke test chạy MCP server thật qua stdio và cần API key:

```bash
npx tsx tests/mcp-smoke.ts
```

## 9. Validation Lab

Validation Lab so sánh hai catalogue representation trên cùng held-out query set:

- `baseline`: title và public product copy.
- `enriched`: public copy cộng các approved structured attributes.

Embedding được tính bằng `text-embedding-3-small`, sau đó so sánh cosine similarity và các
chỉ số Top-1, Top-3, mean rank theo nhóm gap.

Có thể freeze held-out set bằng:

```bash
npm run freeze:heldout -- M01
```

Sau đó chạy baseline và enriched từ Report page. Held-out set đã lock không được sửa hoặc
seed lại.

## 10. Presentation

Repository có presentation deck HTML tĩnh, không cần build hoặc dev server:

- [`presentation/machina-presentation.html`](presentation/machina-presentation.html): bản tiếng Việt.
- [`presentation/machina-presentation-en.html`](presentation/machina-presentation-en.html): bản tiếng Anh.
- [`presentation/README.md`](presentation/README.md): hướng dẫn trình chiếu và danh sách nội dung.

Mở file HTML trực tiếp trong trình duyệt, dùng `F11` để fullscreen và phím mũi tên trái/phải
để chuyển slide. Deck trình bày bài toán, kiến trúc, search flow, scoring, CONTROL, MCP tools,
merchant intelligence loop và Validation Lab.

## 11. Dữ liệu và tính toàn vẹn

Dataset hiện có 9 vertical: running shoes, travel backpacks, wireless headphones, coffee
makers, facial skincare, desk lamps, water bottles, yoga mats và wristwatches. Running shoes
có ba merchant cạnh tranh để minh họa cross-merchant ranking; các vertical còn lại hiện chỉ
có một merchant.

Các nguyên tắc quan trọng:

- `product_facts` được cập nhật tại chỗ; `fact_decisions` là audit log append-only.
- `search_results`, `experiment_runs`, `ranking_impressions` và `ranking_actions` cũng append-only.
- Evidence không có giá trị hợp lệ phải giữ `value = null` với trạng thái `NONE`.
- Disclosure policy được áp dụng tại response boundary trong `packages/core`.
- Các tool nhận `product_id` đều kiểm tra product có thuộc scope hiện tại hay không.

## 12. Giới hạn hiện tại

- Dataset hiện chưa có held-out query fixtures đầy đủ; Validation Lab có thể báo cần cả baseline và enriched run cho đến khi dữ liệu benchmark được author.
- Demand trên dashboard chỉ phản ánh MCP traffic được ghi vào database, không phải historical demand ngoài hệ thống.
- Chỉ running shoes có nhiều merchant đang cạnh tranh thực sự; các vertical khác không thể hiện rõ merchant diversity hoặc các badge so sánh.
- `create_offer` chỉ tạo draft không ràng buộc, chưa có payment hoặc checkout.

## 13. Cấu trúc thư mục

```text
apps/dashboard/      Next.js merchant dashboard
mcp/server/          MCP stdio server
packages/schemas/    Zod schemas, ontology và repo-root helpers
packages/database/   SQLite connection, schema initialization và models
packages/core/       matching, ranking, disclosure, LLM và offers
packages/retrieval/  embedding benchmark và report builder
data/                schema SQL, JSONL dataset, ontologies và image assets
scripts/              migration và dataset utilities
tests/               Vitest tests và live MCP smoke test
skill/SKILL.md       hướng dẫn agent gọi Machina MCP
```

## License

Repository hiện chưa khai báo license. Mặc định các quyền được bảo lưu cho đến khi project
thêm license chính thức.
