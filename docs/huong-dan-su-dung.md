# Hướng dẫn sử dụng Mail Service

Tài liệu này mô tả cách cài đặt, vận hành và sử dụng hệ thống **Mail Service** hiện tại, gồm giao diện web (Hộp thư và quản lý API key) và REST API để các hệ thống bên ngoài gửi email. Nội dung được đối chiếu trực tiếp với source code trong `server/` và `client/`.

> Các phần **Hạn chế đã biết** và **Xử lý sự cố** phản ánh đúng hành vi của code tại thời điểm viết. Một số lỗi được phát hiện bằng cách đọc code và chưa được chạy thử trên database thật; chúng được ghi rõ trong mục 9.

---

## Mục lục

1. [Tổng quan](#1-tổng-quan)
2. [Cài đặt và chạy](#2-cài-đặt-và-chạy)
3. [Sử dụng giao diện web](#3-sử-dụng-giao-diện-web)
4. [Sử dụng API](#4-sử-dụng-api)
5. [Vòng đời API key](#5-vòng-đời-api-key)
6. [Lịch sử gọi mail và audit trail](#6-lịch-sử-gọi-mail-và-audit-trail)
7. [Bảng endpoint](#7-bảng-endpoint)
8. [Mã lỗi và xử lý sự cố](#8-mã-lỗi-và-xử-lý-sự-cố)
9. [Hạn chế đã biết](#9-hạn-chế-đã-biết)

---

## 1. Tổng quan

Hệ thống gồm 3 phần:

| Thành phần | Công nghệ | Vai trò |
| --- | --- | --- |
| `client/` | React 19 + Vite + TypeScript | Giao diện quản trị: soạn/gửi mail, quản lý API key |
| `server/` | Express 5 + Drizzle ORM + Nodemailer | REST API, xác thực API key, gửi mail qua SMTP, ghi log |
| PostgreSQL 16 | Docker (`docker-compose.yml`) | Lưu mail, API key, lịch sử gọi và audit trail |

Luồng xử lý chính:

```
Người dùng (web)  ──►  /api/mails, /api/api-keys  ──►  PostgreSQL
                                   │
Hệ thống bên ngoài ──► /api/mails/send(-bulk)  ──►  SMTP server
    (Bearer API key)               │
                                   └──►  api_key_usage_logs + audit_logs
```

### Trạng thái mail

| Trạng thái | Ý nghĩa |
| --- | --- |
| `QUEUED` | Mail đã được tạo nhưng chưa gửi (hoặc đã thêm vào hàng đợi trên UI) |
| `SENT` | Đã gửi thành công qua SMTP |
| `FAILED` | Gửi SMTP thất bại; lý do lưu trong trường `error` |

Lưu ý: hệ thống **không có worker chạy nền**. Mail ở trạng thái `QUEUED` chỉ được gửi khi bạn bấm **Gửi** trên giao diện hoặc gọi `POST /api/mails/:id/send`.

---

## 2. Cài đặt và chạy

### 2.1. Yêu cầu

- **Node.js ≥ 22** (server chạy TypeScript trực tiếp nhờ type-stripping của Node).
- **Docker Desktop** để chạy PostgreSQL, hoặc một PostgreSQL ≥ 13 tự cài.
- Một **SMTP server** để thực sự gửi mail (xem mục 2.4).

### 2.2. Các bước

```bash
# 1. Cài dependencies cho cả client và server
npm install

# 2. Tạo file cấu hình server
cp server/.env.example server/.env        # Git Bash / macOS / Linux
# Windows CMD: copy server\.env.example server\.env

# 3. Bật PostgreSQL (host port 5433)
npm run db:up

# 4. Tạo bảng (áp các file .sql trong server/migrations)
npm run db:migrate

# 5. (Tuỳ chọn) Nạp 3 mail mẫu — LƯU Ý: lệnh này xoá toàn bộ bảng mails
npm run db:seed

# 6. Chạy API (cổng 4000) và web (cổng 5173)
npm run dev
```

Sau khi chạy:

- Giao diện web: <http://localhost:5173>
- Kiểm tra API và kết nối DB: <http://localhost:4000/api/health>

Có thể dùng `npm run setup` để chạy liên tiếp `npm install`, `db:up`, `db:migrate`, `db:seed`.

### 2.3. Biến môi trường (`server/.env`)

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `DATABASE_URL` | — (bắt buộc) | Chuỗi kết nối PostgreSQL |
| `PORT` | `4000` | Cổng HTTP của API |
| `CORS_ORIGIN` | `http://localhost:5173` | Origin được phép gọi API từ trình duyệt, có thể nhiều giá trị ngăn cách bằng dấu phẩy |
| `NODE_ENV` | `development` | Khi là `production`, API key mới có tiền tố `msk_live_`; còn lại là `msk_test_` |
| `SMTP_HOST` | `localhost` | Địa chỉ SMTP server |
| `SMTP_PORT` | `1025` | Cổng SMTP |
| `SMTP_SECURE` | `false` | `true` nếu dùng TLS trực tiếp (thường là cổng 465) |
| `SMTP_USER` / `SMTP_PASS` | rỗng | Tài khoản SMTP; để trống nếu server không yêu cầu đăng nhập |
| `SMTP_FROM` | `Mail Service <no-reply@example.com>` | Địa chỉ người gửi hiển thị trong mọi email |

Nếu thiếu `DATABASE_URL` hoặc giá trị không hợp lệ, server thoát ngay và in danh sách lỗi cấu hình.

### 2.4. SMTP

Mặc định server thử kết nối `localhost:1025`, không kèm xác thực. Nếu không có SMTP server đang chạy ở địa chỉ đó, mọi lần gửi sẽ trả về `FAILED` với lỗi kết nối. Với môi trường phát triển, bạn có thể chạy một SMTP "hộp thư giả" như Mailpit (cổng mặc định 1025, có giao diện xem mail tại cổng 8025) rồi giữ nguyên cấu hình mặc định.

### 2.5. Chạy production trên một tiến trình

```bash
npm run build     # build server (tsc) rồi build client (vite)
npm start         # chạy server/dist/index.js; server tự phục vụ client/dist
```

Khi đó toàn bộ giao diện và API cùng chạy ở cổng `PORT` (mặc định 4000). Đảm bảo `NODE_ENV=production` nếu muốn key sinh ra có tiền tố `msk_live_`.

### 2.6. Cấu trúc thư mục đáng chú ý

```
server/src/routes/        mails.ts (gửi mail), api-keys.ts, usage.ts, audit-logs.ts, health.ts
server/src/middleware/    api-key-auth.ts (xác thực Bearer), request-context.ts (X-Actor, X-Request-Id)
server/src/services/      mailer.ts (SMTP), template.ts ({{biến}}), usage.ts (ghi lịch sử gọi)
server/src/lib/           api-keys.ts (sinh/hash key), audit.ts (gắn actor vào transaction)
server/migrations/        0001_init.sql, 0002_api_keys_usage_audit.sql
client/src/components/    MailboxPage, MailForm, ApiKeysPage, ApiKeyDetailDialog, ...
```

Khi thay đổi schema, **thêm một file `.sql` mới** trong `server/migrations/` thay vì sửa file cũ.

---

## 3. Sử dụng giao diện web

Trang có hai tab, đặt ngay dưới tiêu đề: **Hộp thư** và **API key**. Liên kết `http://localhost:5173/#keys` mở thẳng tab API key.

Góc trên bên phải hiển thị trạng thái kết nối: `API OK · DB up` khi hệ thống hoạt động, hoặc `Mất kết nối API` khi API không phản hồi. Trạng thái được kiểm tra lại mỗi 15 giây.

Thông báo thành công tự ẩn sau 5 giây; thông báo lỗi giữ nguyên cho đến khi bạn đóng.

### 3.1. Tab Hộp thư

#### Gửi đơn (một người nhận)

1. Chọn chế độ **Gửi đơn**.
2. Nhập **Người nhận**, **Tiêu đề** (tối đa 200 ký tự) và **Nội dung** (tối đa 20.000 ký tự).
3. Chọn một trong hai nút:
   - **Gửi ngay**: tạo mail rồi gửi SMTP ngay lập tức.
   - **Thêm vào hàng đợi**: chỉ lưu mail với trạng thái `QUEUED`, chưa gửi.

#### Gửi hàng loạt (nhiều người nhận, có biến)

1. Chọn chế độ **Gửi hàng loạt**.
2. Viết tiêu đề và nội dung có chứa **biến** theo cú pháp `{{ten_bien}}`. Ví dụ: `Chào {{name}}, mã của bạn là {{code}}`.
   - Tên biến chỉ gồm chữ không dấu, số và dấu gạch dưới.
   - Hệ thống tự nhận diện các biến và hiển thị thành thẻ phía dưới ô nội dung.
3. Thêm từng người nhận (tối đa **100** người). Mỗi người có một ô email và một ô cho từng biến; tất cả đều bắt buộc.
4. Dùng khung **Xem trước** để xem nội dung đã điền cho từng người nhận (chọn người nhận trong danh sách thả xuống).
5. Bấm **Gửi ngay** (gửi toàn bộ) hoặc **Thêm vào hàng đợi** (chỉ lưu).

Sau khi gửi hàng loạt, thông báo cho biết số email gửi thành công và số thất bại. Nếu một người nhận thiếu biến, cả lô bị từ chối và không có email nào được gửi.

#### Danh sách mail

- **Bộ lọc trạng thái**: Tất cả / Đang chờ / Đã gửi / Thất bại.
- **Tìm kiếm**: theo email người nhận hoặc tiêu đề (có độ trễ 350 ms sau khi gõ).
- **Làm mới**: tải lại danh sách.
- Trên mỗi mail:
  - **Gửi** (mail `QUEUED`) hoặc **Gửi lại** (mail `FAILED`): gửi SMTP lần nữa. Mail đã `SENT` không hiển thị nút này.
  - **Xoá**: xoá hẳn mail khỏi database (không phải xoá mềm). Xem thêm mục 9 về một trường hợp lỗi khi xoá.
  - Nếu gửi thất bại, dòng ⚠ phía dưới hiển thị lý do lỗi SMTP.

Danh sách chỉ hiển thị **50 mail mới nhất** theo bộ lọc hiện tại; giao diện chưa có phân trang.

### 3.2. Tab API key

Tab này cho phép quản lý toàn bộ vòng đời key. Mỗi key hiển thị tiền tố (ví dụ `msk_test_a1b2c3…9x2f`), trạng thái, phạm vi (`mail:send`), hạn dùng, lần dùng gần nhất và người tạo.

**Bộ lọc** theo trạng thái (Tất cả / Đang hoạt động / Đã thu hồi) và **tìm kiếm** theo tên hoặc tiền tố. Danh sách tải 50 key mỗi lần, có nút **Tải thêm**.

#### Tạo key

1. Bấm **+ Tạo key**.
2. Nhập **Tên key** (bắt buộc, tối đa 120 ký tự), **Mô tả** (tuỳ chọn, tối đa 500 ký tự) và **Hết hạn** (tuỳ chọn, phải là thời điểm trong tương lai).
3. Bấm **Tạo key**. Hộp thoại hiện **secret một lần**, kèm nút Copy và ví dụ `curl` gửi mail bằng key đó.

> **Secret chỉ hiển thị một lần.** Hệ thống chỉ lưu SHA-256 hash, không thể lấy lại secret từ database hay từ API. Đóng hộp thoại mà chưa lưu thì phải tạo secret mới (rotate).

#### Các thao tác trên mỗi key

| Nút | Điều kiện | Tác dụng |
| --- | --- | --- |
| **Lịch sử** | Mọi key | Mở chi tiết: lịch sử gọi mail và audit trail (mục 6) |
| **Sửa** | Mọi key | Đổi tên, mô tả, hạn dùng. Không đổi được secret ở đây |
| **Secret mới** | Chỉ key đang hoạt động | Sinh secret mới; secret cũ mất hiệu lực ngay. Id và lịch sử được giữ nguyên |
| **Thu hồi** | Chỉ key đang hoạt động | Vô hiệu hoá key; mọi request dùng key sẽ bị từ chối với 401 |
| **Xoá** | Mọi key | Xoá mềm: thu hồi và ẩn khỏi danh sách; lịch sử và audit vẫn được giữ |

Mỗi thao tác **Secret mới**, **Thu hồi**, **Xoá** đều có hộp thoại xác nhận.

---

## 4. Sử dụng API

Base URL: `http://localhost:4000/api`

### 4.1. Quy ước chung

- Body là JSON; đặt header `Content-Type: application/json`.
- Giới hạn kích thước body: 1 MB.
- **Header tuỳ chọn**:
  - `X-Actor`: tên người hoặc hệ thống đang thao tác. Mặc định `system`. Giá trị này được ghi vào `created_by`, `updated_by` và audit trail.
  - `X-Request-Id`: mã truy vết (chỉ gồm chữ, số, `.`, `_`, `:`, `-`, tối đa 128 ký tự). Nếu thiếu hoặc không hợp lệ, server tự sinh UUID. Mọi response đều trả lại header này, và nó được ghi vào log gọi mail để bạn đối chiếu.
- Lỗi validation trả về `400` với `issues` (mục 8).

### 4.2. Tạo API key

Đây là endpoint quản trị và **hiện chưa xác thực** (xem mục 9). Chỉ gọi trong mạng nội bộ.

```bash
curl -X POST http://localhost:4000/api/api-keys \
  -H "Content-Type: application/json" \
  -H "X-Actor: alice" \
  -d '{"name":"Website","description":"Key cho form liên hệ","scopes":["mail:send"],"expiresAt":"2027-01-01T00:00:00+07:00"}'
```

Phản hồi `201`:

```json
{
  "id": "5b0c…",
  "name": "Website",
  "prefix": "msk_test_a1b2c3…9x2f",
  "status": "ACTIVE",
  "scopes": ["mail:send"],
  "key": "msk_test_a1b2c3…(43 ký tự)…",
  "keyNotice": "Store this key now. It is shown only once and cannot be recovered."
}
```

Lưu ngay trường `key`. Các response về sau không còn trả về secret.

Định dạng secret: `msk_test_` hoặc `msk_live_`, theo sau là 43 ký tự base64url.

### 4.3. Gửi một mail bằng API key

```bash
curl -X POST http://localhost:4000/api/mails/send \
  -H "Authorization: Bearer msk_test_..." \
  -H "Content-Type: application/json" \
  -H "X-Actor: alice" \
  -H "X-Request-Id: req-20261101-001" \
  -d '{"to":"khach@example.com","subject":"Xin chào","body":"Nội dung email"}'
```

- Body có đúng ba trường: `to` (email hợp lệ), `subject` (1–200 ký tự), `body` (1–20.000 ký tự). Không hỗ trợ biến trong endpoint này.
- Email được gửi **đồng bộ**: request chỉ trả về sau khi SMTP xử lý xong.

Thành công (`201`): trả về bản ghi mail với `"status": "SENT"`.

Thất bại SMTP (`502`): `{"error":"Failed to deliver email via SMTP: ..."}`. Bản ghi mail vẫn được lưu với trạng thái `FAILED`, nhưng response **không kèm id** của mail. Muốn tìm id, tra `GET /api/usage-logs?apiKeyId=<id>` (mục 6).

### 4.4. Gửi hàng loạt bằng API key

```bash
curl -X POST http://localhost:4000/api/mails/send-bulk \
  -H "Authorization: Bearer msk_test_..." \
  -H "Content-Type: application/json" \
  -d '{
    "subject": "Chào {{name}}",
    "body": "Mã nhân viên của bạn là {{code}}.",
    "recipients": [
      { "to": "an@example.com",  "variables": { "name": "An",  "code": "A01" } },
      { "to": "binh@example.com", "variables": { "name": "Bình", "code": "B02" } }
    ]
  }'
```

**Quy tắc template:**

- Biến có dạng `{{ten_bien}}`; khoảng trắng bên trong dấu ngoặc được bỏ qua (`{{ name }}` vẫn hợp lệ).
- Hệ thống lấy **tập biến của cả tiêu đề và nội dung**. Mỗi người nhận phải có đủ mọi biến này với giá trị không rỗng (sau khi cắt khoảng trắng).
- Biến thừa trong `variables` của người nhận sẽ bị bỏ qua.
- Chỉ tiêu đề và nội dung được thay biến; `to` không được thay.
- Kiểm tra toàn bộ lô **trước khi gửi**. Nếu có một người nhận thiếu biến, trả `400` và **không gửi email nào**.

**Giới hạn:** tối đa **100** người nhận mỗi lô; tiêu đề ≤ 200 ký tự; nội dung ≤ 20.000 ký tự.

Thành công (`201`):

```json
{
  "total": 2,
  "queuedCount": 0,
  "sentCount": 1,
  "failedCount": 1,
  "items": [
    { "id": "…", "to": "an@example.com", "status": "SENT", "...": "..." },
    { "id": "…", "to": "binh@example.com", "status": "FAILED", "error": "Failed to deliver email via SMTP: ..." }
  ]
}
```

- Lô được gửi **tuần tự** trong cùng request; mỗi người nhận có một bản ghi mail riêng.
- Một người nhận thất bại không làm dừng các người nhận còn lại.
- Endpoint **luôn trả `201`**, kể cả khi `failedCount` bằng `total`. Hãy kiểm tra `failedCount` và `items[].status` thay vì chỉ dựa vào mã HTTP.
- `queuedCount` luôn là `0` ở endpoint này vì endpoint luôn gửi ngay (không có tuỳ chọn xếp hàng).

### 4.5. Quản lý mail (endpoint cho giao diện)

Các endpoint này không yêu cầu API key, dùng cho giao diện quản trị và công cụ nội bộ.

| Mục đích | Request |
| --- | --- |
| Danh sách | `GET /api/mails?status=QUEUED&search=khach&limit=50&offset=0` |
| Chi tiết | `GET /api/mails/:id` |
| Tạo mail (chưa gửi) | `POST /api/mails` với `{to, subject, body}` |
| Gửi mail đã tạo | `POST /api/mails/:id/send` (mail `SENT` trả `409`) |
| Tạo và gửi/xếp hàng hàng loạt | `POST /api/mails/bulk` với `{subject, body, recipients, sendNow?}`; `sendNow` mặc định `true` |
| Đổi trạng thái thủ công | `PATCH /api/mails/:id` với `{status, error?}` |
| Xoá | `DELETE /api/mails/:id` (xoá cứng, trả `204`) |

`POST /api/mails/:id/send` có thể đính kèm Bearer key. Khi có key, lần gọi được ghi vào lịch sử gọi mail, còn response vẫn giữ nguyên định dạng như khi không có key.

`POST /api/mails/bulk` khác với `send-bulk` ở chỗ: nó dành cho giao diện, không bắt buộc key, và cho phép `sendNow: false` để chỉ xếp hàng (trả `queuedCount` bằng số mail đã lưu, `sentCount` bằng `0`).

### 4.6. Tra cứu lịch sử và audit

```bash
# Lịch sử gọi mail của một key, lọc theo kết quả
curl "http://localhost:4000/api/api-keys/<key-id>/usage?outcome=FAILED"

# Lịch sử toàn hệ thống, lọc theo khoảng thời gian (ISO kèm múi giờ)
curl "http://localhost:4000/api/usage-logs?apiKeyId=<key-id>&from=2026-11-01T00:00:00%2B07:00"

# Audit trail của một key
curl "http://localhost:4000/api/audit-logs?entity=api_key&entityId=<key-id>"
```

Chi tiết các tham số có ở mục 7.

### 4.7. Các thao tác quản lý key

```bash
# Đổi tên, mô tả, hạn dùng (đặt expiresAt = null để bỏ hạn)
curl -X PATCH http://localhost:4000/api/api-keys/<key-id> \
  -H "Content-Type: application/json" \
  -d '{"name":"Website v2","expiresAt":null}'

# Sinh secret mới (secret cũ mất hiệu lực ngay)
curl -X POST http://localhost:4000/api/api-keys/<key-id>/rotate

# Thu hồi (đã thu hồi thì trả 409)
curl -X POST http://localhost:4000/api/api-keys/<key-id>/revoke \
  -H "Content-Type: application/json" -d '{"reason":"Lộ secret"}'

# Xoá mềm (trả 204)
curl -X DELETE http://localhost:4000/api/api-keys/<key-id>
```

---

## 5. Vòng đời API key

| Trạng thái / hành động | Gọi `/mails/send` bằng key | Ghi lịch sử | Ghi audit |
| --- | --- | --- | --- |
| `ACTIVE` | Được phép (nếu còn hạn) | `SUCCESS` hoặc `FAILED` | — |
| Đã hết hạn (`expiresAt` đã qua) | `401 API key has expired` | `REJECTED` | — |
| `REVOKED` (thu hồi) | `401 API key has been revoked` | `REJECTED` | `REVOKE` |
| `Secret mới` (rotate) | Secret cũ: `401 Invalid API key`; secret mới: hoạt động | Secret cũ không ghi (không xác định được chủ) | `ROTATE` |
| Xoá mềm | `401 Invalid API key` | Không ghi | `DELETE` |
| Secret sai hoặc không tồn tại | `401 Invalid API key` | Không ghi (không xác định được chủ) | — |
| Thiếu scope `mail:send` | `403` | `REJECTED` (`INSUFFICIENT_SCOPE`) | — |

Ghi chú:

- Key bị chặn vẫn để lại dấu vết `REJECTED`, nên bạn có thể thấy ai đang cố dùng key đã thu hồi.
- Hiện chỉ có scope `mail:send`.
- `last_used_at` được cập nhật sau mỗi lần key được ghi nhận sử dụng, và hiển thị trên giao diện.

---

## 6. Lịch sử gọi mail và audit trail

### 6.1. Lịch sử gọi mail (`api_key_usage_logs`)

Mỗi lần gọi endpoint gửi mail bằng key tạo một dòng. Các trường quan trọng:

| Trường | Ý nghĩa |
| --- | --- |
| `outcome` | `SUCCESS`, `FAILED` (mail không tồn tại, đã gửi, validation lỗi, SMTP lỗi), hoặc `REJECTED` (key bị thu hồi/hết hạn/thiếu scope) |
| `statusCode` | Mã HTTP trả về |
| `errorCode` / `errorMessage` | Mã và nội dung lỗi (ví dụ `MAIL_SEND_FAILED`, `INVALID_REQUEST`) |
| `mailId` | Id của mail liên quan (có thể `null`) |
| `durationMs` | Thời gian xử lý |
| `requestId`, `ipAddress`, `userAgent` | Thông tin truy vết |

Bảng này là **append-only**: trigger chặn mọi `UPDATE` và `DELETE`. Muốn sửa phải tắt trigger trong một cửa sổ bảo trì có kiểm soát.

Với `send-bulk`, hệ thống ghi **một dòng** cho cả lô: `SUCCESS` nếu có ít nhất một email thành công, `FAILED` (mã `502`) nếu toàn bộ thất bại; `mailId` là mail đầu tiên của lô.

### 6.2. Audit trail (`audit_logs`)

Trigger PostgreSQL ghi một dòng mỗi khi bản ghi `api_keys` được tạo, sửa, thu hồi, rotate hoặc xoá. Hành động gồm `CREATE`, `UPDATE`, `REVOKE`, `ROTATE`, `DELETE`. Mỗi dòng chứa snapshot `before`/`after` (đã loại `key_hash`) và các trường `actor`, `requestId`, `ipAddress`, `userAgent`.

Một số điểm cần biết:

- Các lần chỉ cập nhật `last_used_at` **không** sinh dòng audit, để log không bị nhiễu.
- Vì ghi bằng trigger, thay đổi làm bằng SQL trực tiếp cũng được ghi lại. Khi đó `actor` là `system` trừ khi thao tác đi qua ứng dụng.
- `actor` lấy từ header `X-Actor` và **không được xác thực**. Bất kỳ ai gọi API đều có thể điền tên tuỳ ý.

---

## 7. Bảng endpoint

Mọi đường dẫn bắt đầu bằng `/api`.

### 7.1. Sức khoẻ hệ thống

| Method | Endpoint | Ghi chú |
| --- | --- | --- |
| GET | `/health` | `200` khi DB hoạt động, `503` khi DB lỗi |

### 7.2. Mail

| Method | Endpoint | Xác thực | Mã thành công |
| --- | --- | --- | --- |
| GET | `/mails?status=&search=&limit=&offset=` | Không | 200 |
| GET | `/mails/:id` | Không | 200 |
| POST | `/mails` | Không | 201 |
| POST | `/mails/send` | Bearer key (`mail:send`) | 201 |
| POST | `/mails/send-bulk` | Bearer key (`mail:send`) | 201 |
| POST | `/mails/bulk` | Không (có thể đính kèm key) | 201 |
| POST | `/mails/:id/send` | Không (có thể đính kèm key) | 200 |
| PATCH | `/mails/:id` | Không | 200 |
| DELETE | `/mails/:id` | Không | 204 |

Tham số: `limit` tối đa 100 (mặc định 50); `status` ∈ `QUEUED | SENT | FAILED`.

### 7.3. API key

| Method | Endpoint | Ghi chú |
| --- | --- | --- |
| POST | `/api-keys` | Trả secret một lần; `201` |
| GET | `/api-keys?status=&search=&limit=&offset=` | `status` ∈ `ACTIVE | REVOKED`; không gồm key đã xoá mềm |
| GET | `/api-keys/:id` | Không bao giờ trả hash |
| GET | `/api-keys/:id/usage?outcome=&from=&to=&limit=&offset=` | Lịch sử của một key |
| PATCH | `/api-keys/:id` | Đổi `name`, `description`, `scopes`, `expiresAt` (`null` để bỏ) |
| POST | `/api-keys/:id/rotate` | Trả secret mới; `409` nếu key đã thu hồi |
| POST | `/api-keys/:id/revoke` | Body tuỳ chọn `{reason}`; `409` nếu đã thu hồi |
| DELETE | `/api-keys/:id` | Xoá mềm; `204` |

### 7.4. Lịch sử và audit

| Method | Endpoint | Tham số lọc |
| --- | --- | --- |
| GET | `/usage-logs` | `apiKeyId`, `mailId`, `outcome`, `from`, `to`, `limit` (≤ 200), `offset` |
| GET | `/audit-logs` | `entity`, `entityId`, `action`, `actor`, `from`, `to`, `limit` (≤ 200), `offset` |

`from` và `to` là thời điểm ISO 8601 **có kèm múi giờ**, ví dụ `2026-11-01T00:00:00+07:00`. Khi bạn truyền `+` trên dòng lệnh, hãy mã hoá thành `%2B`.

---

## 8. Mã lỗi và xử lý sự cố

### 8.1. Mã HTTP

| Mã | Khi nào |
| --- | --- |
| 400 | Dữ liệu không hợp lệ (`Validation failed`), id sai định dạng, thiếu biến template |
| 401 | Thiếu key, sai định dạng header, key không tồn tại, key đã thu hồi, key đã hết hạn |
| 403 | Key không có scope `mail:send` |
| 404 | Mail hoặc key không tồn tại; route không có |
| 409 | Mail đã gửi rồi; key đã thu hồi (khi thu hồi lại hoặc rotate) |
| 502 | Gửi SMTP thất bại (`MAIL_SEND_FAILED`) |
| 500 | Lỗi không xác định; xem log server |

### 8.2. Dạng lỗi validation

```json
{
  "error": "Validation failed",
  "issues": [
    { "path": "to", "message": "Must be a valid email address" }
  ]
}
```

### 8.3. Xử lý sự cố thường gặp

| Triệu chứng | Nguyên nhân thường gặp | Cách xử lý |
| --- | --- | --- |
| Giao diện báo `Mất kết nối API` | API chưa chạy hoặc cổng khác 4000 | Kiểm tra `npm run dev`, mở `/api/health` |
| `/api/health` trả `503`, `database: down` | PostgreSQL chưa bật hoặc sai `DATABASE_URL` | `npm run db:up`, kiểm tra cổng 5433 |
| Server thoát ngay, báo `Invalid environment configuration` | Thiếu `server/.env` hoặc thiếu `DATABASE_URL` | Tạo file `.env` từ `.env.example` |
| Mail chuyển sang `FAILED`, lỗi `Failed to deliver email via SMTP: connect ECONNREFUSED` | Chưa có SMTP server ở `SMTP_HOST:SMTP_PORT` | Bật SMTP server hoặc sửa cấu hình |
| Mail `FAILED` với lỗi xác thực SMTP | Sai `SMTP_USER` / `SMTP_PASS` | Sửa biến môi trường rồi bấm **Gửi lại** |
| `401 Invalid API key` | Secret bị sao chép thiếu, hoặc key đã được rotate | Dùng secret mới nhất; nếu mất, tạo rotate |
| `401 API key has been revoked` | Key đã thu hồi | Tạo key mới |
| `403 ... required scope: mail:send` | Key không có scope | Sửa scope bằng `PATCH` hoặc tạo key mới |
| `Recipient ... is missing template variables` | Một người nhận thiếu biến | Bổ sung biến; lô bị từ chối nên không có email nào được gửi |
| Lô `send-bulk` trả `201` nhưng `failedCount` lớn | Lỗi SMTP từng người | Đọc `items[].error` và gửi lại các mail `FAILED` |
| Thiếu `CORS` trên trình duyệt | Origin của web không có trong `CORS_ORIGIN` | Thêm origin vào `CORS_ORIGIN` và khởi động lại |

---

## 9. Hạn chế đã biết

### 9.1. Lỗi phát hiện khi đọc code (chưa chạy thử)

**Không xoá được mail đã từng gửi bằng API key.**
`api_key_usage_logs.mail_id` được khai báo `ON DELETE SET NULL`, nhưng bảng này bị trigger `api_key_usage_logs_append_only` chặn mọi `UPDATE`. Khi xoá một mail có lịch sử gọi, PostgreSQL phải `UPDATE` các dòng usage để đặt `mail_id = NULL`, và thao tác này bị chặn. Hệ quả dự kiến:

- `DELETE /api/mails/:id` cho mail có lịch sử gọi trả `500`.
- `npm run db:seed` (xoá toàn bộ `mails`) thất bại nếu đã có lịch sử gọi.

Hướng sửa: đổi FK sang `ON DELETE RESTRICT` hoặc giữ nguyên `mail_id` mà không ràng buộc FK, hoặc để trigger bỏ qua UPDATE chỉ đổi `mail_id` về `NULL`.

### 9.2. Bảo mật

- **Toàn bộ API quản trị không có xác thực**: `/api/mails` (trừ các endpoint gửi bằng key), `/api/api-keys`, `/api/usage-logs`, `/api/audit-logs`. Bất kỳ ai truy cập được API đều có thể tạo, thu hồi key hoặc xoá mail. Chỉ mở trong mạng nội bộ, hoặc đặt sau một lớp xác thực trước khi public.
- Header `X-Actor` không được xác thực, nên audit trail chỉ đáng tin khi API chưa tiếp xúc người dùng ngoài.
- Secret chỉ được hiển thị một lần và được lưu dưới dạng SHA-256 hash; không có cơ chế lấy lại.

### 9.3. Chức năng

- **Không có hàng đợi nền**: mail `QUEUED` không tự được gửi. Mọi lần gửi là đồng bộ trong request.
- **Gửi hàng loạt tuần tự** và không có giới hạn thời gian riêng. Với lô 100 người nhận, request có thể chạy lâu.
- **Chỉ gửi văn bản thuần** (`text`), không hỗ trợ HTML, file đính kèm hay địa chỉ CC/BCC.
- **Endpoint `/mails/send` không trả id** khi SMTP thất bại (mục 4.3).
- **Giao diện chỉ hiển thị 50 mail mới nhất**, không có phân trang. API thì có `limit` và `offset`.
- **Body vượt 1 MB** có thể trả `500` thay vì `413`, vì error handler chưa nhận diện lỗi parse của Express.
- `DELETE /api/mails/:id` là xoá cứng, không có thùng rác.

### 9.4. Tài liệu README cần cập nhật

README hiện mô tả `POST /api/mails/:id/send` là "placeholder chỉ đổi trạng thái", trong khi code đã gửi thật qua SMTP. Bảng endpoint trong README cũng chưa có `/mails/send`, `/mails/send-bulk` và `/mails/bulk`. Tài liệu này phản ánh đúng code hiện tại.
