# Đánh giá hệ thống Mail Service

> Ngày đánh giá: 2026-11-09 · Phạm vi: toàn bộ `server/src`, `client/src`, migrations, Docker/Vercel config, package manifests.
> Không đọc nội dung `server/.env`, `.env.local` (chứa bí mật); chỉ kiểm tra việc chúng được `.gitignore`.

## 1. Tổng quan kiến trúc

| Thành phần | Công nghệ | Ghi chú |
|---|---|---|
| Client | React + Vite (TypeScript) | 2 tab: Hộp thư, API key |
| API | Express 5 + Zod 4 + Drizzle ORM | Monorepo npm workspaces |
| DB | SQLite / libSQL (Turso) | Local file (Docker) hoặc Turso (Vercel) |
| Gửi mail | Nodemailer (SMTP, chỉ `text`) | `services/mailer.ts` |
| Event bus | Kafka (kafkajs) | Consumer `mail.send` → SMTP, DLQ `mail.send.dlq` |
| Triển khai | Docker (compose) / Vercel serverless | `api/index.mjs` bọc `createApp()` |

Luồng chính:
- **Admin UI** → `/api/mails` (tạo, gửi, bulk, xoá) và `/api/api-keys`.
- **Dịch vụ ngoài** → `POST /api/mails/send` / `send-bulk` với `Authorization: Bearer msk_...` (scope `mail:send`).
- **Kafka** → `mail-consumer` gửi trực tiếp qua SMTP, lỗi sau 3 lần thử chuyển DLQ.

## 2. Điểm mạnh

- **Cấu trúc code rõ ràng**, tách `routes / services / middleware / lib`; guard clause và validate bằng Zod nhất quán.
- **Quản lý API key tốt**: key 256-bit ngẫu nhiên, chỉ lưu SHA-256 (`keyHash`), trả plaintext một lần, có prefix/last4, rotate, revoke, soft delete, expiry, kiểm tra scope ([api-keys.ts](file:///d:/IT/mail-service/server/src/lib/api-keys.ts), [api-key-auth.ts](file:///d:/IT/mail-service/server/src/middleware/api-key-auth.ts)).
- **Audit & usage ledger**: ghi `REJECTED/FAILED/SUCCESS`, request-id, IP, UA; thao tác key nằm trong transaction cùng audit.
- **Chống gửi trùng khi bấm gửi lặp**: claim nguyên tử `QUEUED/FAILED → SENDING` trước khi gửi ([mails.ts L444-L459](file:///d:/IT/mail-service/server/src/routes/mails.ts#L444-L459)).
- **Bulk template**: kiểm tra biến thiếu và độ dài sau render cho toàn bộ người nhận trước khi gửi; trả `207` khi thành công một phần.
- **Kafka consumer chịu lỗi**: retry + backoff, DLQ kèm header lỗi, tự reconnect, không làm sập API khi broker down, graceful shutdown.
- **Env validation** bằng Zod (fail-fast), SSL/SASL kiểm tra cặp cấu hình.
- Docker chạy user non-root, healthcheck, volume cho SQLite WAL.

## 3. Vấn đề phát hiện

### 🔴 Nghiêm trọng

| # | Vấn đề | Vị trí | Hệ quả |
|---|---|---|---|
| C1 | **Không có xác thực cho toàn bộ API quản trị.** `/api/api-keys` (tạo/rotate/revoke/xoá), `/api/audit-logs`, `/api/usage-logs`, `/api/mails` (CRUD) đều mở. | [app.ts L25-L29](file:///d:/IT/mail-service/server/src/app.ts#L25-L29) | Bất kỳ ai truy cập được URL đều tự tạo API key hợp lệ, đọc log, xoá thư. Làm vô hiệu hoá toàn bộ cơ chế API key. |
| C2 | **Gửi mail không cần key (open relay).** `POST /:id/send` và `POST /bulk` dùng `optionalApiKey` (không header = cho qua); kết hợp `POST /` tạo thư không auth → gửi tới bất kỳ địa chỉ với nội dung tuỳ ý qua SMTP của bạn. | [mails.ts L336, L415](file:///d:/IT/mail-service/server/src/routes/mails.ts#L336) | Lạm dụng spam, lộ uy tín/domain SMTP, tốn quota. |
| C3 | **`X-Actor` do client tự khai** và ghi nguyên vào `audit_logs`, `created_by`. | [request-context.ts L35](file:///d:/IT/mail-service/server/src/middleware/request-context.ts#L35) | Audit trail có thể bị giả mạo, không còn giá trị truy vết. |
| C4 | **Không rate limit / giới hạn tần suất** ở bất kỳ endpoint nào (kể cả đoán key, gửi bulk 100 thư/request lặp liên tục). | toàn app | Brute-force, flood SMTP, DoS. |

### 🟠 Cao

| # | Vấn đề | Chi tiết |
|---|---|---|
| H1 | **Migration SQL bị lệch với hệ thống thật.** `server/migrations/*.sql` là PostgreSQL (enum, trigger, `inet`, `uuid`) nhưng runtime là SQLite và `migrate.ts` tự viết DDL riêng. Các **trigger audit / append-only không tồn tại trên SQLite**, trong khi comment ở `schema.ts` và `usage.ts` vẫn nói "append-only". UI còn ghi "PostgreSQL" ([App.tsx L78](file:///d:/IT/mail-service/client/src/App.tsx#L78)). | Ledger/audit có thể bị sửa/xoá trực tiếp trong DB; tài liệu gây hiểu nhầm; DDL trùng lặp 2 nơi (schema.ts vs migrate.ts) dễ drift, không có version/bảng migrations. |
| H2 | **Bulk gửi tuần tự trong 1 request** (tối đa 100 thư × SMTP) ([mails.ts L218](file:///d:/IT/mail-service/server/src/routes/mails.ts#L218)). | Dễ vượt `maxDuration: 60s` trên Vercel và timeout client; khi request bị cắt, thư kẹt `SENDING` vĩnh viễn (không có cơ chế phục hồi/timeout). |
| H3 | **Lộ thông tin nội bộ qua lỗi SMTP**: `MailDeliveryError` trả `Failed to deliver email via SMTP: <reason>` cho client và lưu vào `mails.error`. | Lộ host/cấu hình/mã lỗi SMTP cho caller bên ngoài. |
| H4 | **Kafka consumer không idempotent, không persist.** Thư từ Kafka gửi thẳng SMTP, không ghi bảng `mails`/usage; at-least-once ⇒ có thể gửi trùng; `to` chỉ `min(1)` (không kiểm tra email), `body` không giới hạn độ dài; nếu publish DLQ thất bại → exception trong `eachMessage`. | Không truy vết được thư qua Kafka, không giới hạn payload, nguy cơ gửi trùng/mất. |
| H5 | **Không có test tự động / CI.** Thư mục `scripts/` (gồm `test-bugfixes.mjs`, `test-bulk-mail.mjs`) bị liệt kê trong `.gitignore` ⇒ không được commit. | Không bảo vệ hồi quy; thay đổi rủi ro. |

### 🟡 Trung bình

| # | Vấn đề | Chi tiết |
|---|---|---|
| M1 | `/api/health` công khai và mỗi lần gọi tạo kết nối admin Kafka mới; UI poll mỗi 15 giây/mỗi tab. | Tốn tài nguyên broker, có thể bị lợi dụng; trả trạng thái nội bộ cho mọi người. UI chỉ hiển thị `database`, bỏ qua `kafka`. |
| M2 | `like(... %search%)` không escape `%`/`_`. | Kết quả tìm kiếm sai lệch; không phải SQL injection (đã tham số hoá) nhưng có thể gây truy vấn nặng. |
| M3 | `recordUsage` nuốt lỗi (chỉ `console.error`). | Chủ đích để không làm hỏng việc gửi, nhưng ledger có thể mất bản ghi âm thầm; nên có metric/cảnh báo. Trái guideline "không swallow" — cần ghi rõ ngoại lệ. |
| M4 | Mail lưu `body` plaintext vĩnh viễn; không retention/xoá; log usage lưu `ip`, `userAgent`, `path` (kèm query). | Rủi ro dữ liệu cá nhân (PII); cần chính sách lưu giữ. |
| M5 | `trust proxy` chưa cấu hình ⇒ `req.ip` sau reverse proxy/Vercel là IP proxy. | Audit/usage ghi sai IP. |
| M6 | Không có header bảo mật (helmet), CORS mặc định chỉ `localhost:5173` (ổn) nhưng khi deploy phải cấu hình. | Hardening còn thiếu. |
| M7 | Mailer chỉ gửi `text`, không có `Message-ID`/idempotency key ở API ngoài; `POST /send` không hỗ trợ `Idempotency-Key`. | Client retry ⇒ gửi trùng. |
| M8 | `withAudit(_context, ...)` nhận `context` nhưng bỏ qua; `normalizeIp` comment nhắc cột `inet` (Postgres). | Mã thừa/gây nhầm sau khi chuyển sang SQLite. |

### 🟢 Thấp / Vệ sinh repo

- Repo chứa `.npm-cache/` (đã ignore), `.claude/worktrees/` (**chưa ignore**, nhân bản cả source), `data/p4-check.db`, `server/.cert` và `server/certs` trùng `ca.pem`.
- `Dockerfile` dùng `npm install` thay vì `npm ci` (build không tái lập hoàn toàn); chưa có `.dockerignore` kiểm tra cho `.claude`.
- `client` có `pnpm-lock.yaml` trong khi root dùng npm workspaces (lockfile lẫn lộn).
- Footer UI hard-code `localhost:4000/5173`.
- `docs/` có nhiều tài liệu chồng lấn (`features`, `requirements-next`, `de-xuat-cai-thien`) — nên hợp nhất, đánh dấu cái nào đã lỗi thời (nhắc PostgreSQL).
- Scope chỉ có `mail:send`; các route đọc không có scope tương ứng.

## 4. Chấm điểm

| Tiêu chí | Điểm (/10) | Nhận xét ngắn |
|---|---|---|
| Chất lượng code & cấu trúc | 8 | Sạch, nhất quán, type-safe |
| Bảo mật | **3** | Thiết kế key tốt nhưng bị phá vỡ bởi C1–C4 |
| Độ tin cậy / vận hành | 6 | Retry, DLQ, graceful shutdown tốt; thiếu recovery `SENDING`, bulk đồng bộ |
| Khả năng mở rộng | 5 | SQLite + SMTP đồng bộ trong request; Kafka chưa tích hợp với DB |
| Khả năng quan sát | 6 | Request-id, audit, usage có; chưa có metrics/log có cấu trúc |
| Kiểm thử | 2 | Không có test trong repo |
| Tài liệu & nhất quán | 5 | Nhiều, nhưng lệch Postgres/SQLite |
| **Tổng thể** | **5 / 10** | Nền tảng tốt, chưa sẵn sàng public production |

## 5. Khuyến nghị theo mức ưu tiên

### Ngay lập tức (trước khi expose ra internet)
1. **Thêm xác thực admin** (session/JWT/OIDC hoặc tối thiểu admin token từ env) cho `/api/api-keys`, `/api/audit-logs`, `/api/usage-logs`, `/api/mails/*`; lấy `actor` từ danh tính đã xác thực, bỏ `X-Actor`.
2. **Bắt buộc API key** cho mọi endpoint gửi (`/bulk`, `/:id/send`) hoặc yêu cầu auth admin; không dùng `optionalApiKey`.
3. **Rate limit** theo IP và theo API key (ví dụ `express-rate-limit`), kèm quota ngày/key.
4. Che thông điệp SMTP trả ra ngoài (trả mã lỗi chung, giữ chi tiết trong log nội bộ).

### Ngắn hạn
5. Chọn **một** nguồn sự thật cho schema: dùng `drizzle-kit` migrations cho SQLite, xoá/di chuyển SQL Postgres cũ; nếu cần append-only, tạo trigger SQLite tương ứng.
6. Chuyển bulk sang **hàng đợi** (đã có Kafka): API chỉ enqueue, worker gửi; thêm timeout/phục hồi cho `SENDING` (reaper theo `updatedAt`).
7. Kafka consumer: validate `to` bằng email schema, giới hạn `body`, ghi `mails` + dedupe theo message key/`Idempotency-Key`; xử lý lỗi publish DLQ.
8. Viết **test tự động** (Vitest/supertest) và CI (typecheck + test); bỏ `scripts/` khỏi `.gitignore` hoặc chuyển vào `tests/`.

### Dài hạn
9. Retention/xoá PII, mã hoá hoặc rút gọn body lưu trữ.
10. `trust proxy`, helmet, health endpoint tách `/live` và `/ready`, cache kết quả probe Kafka.
11. Metrics (Prometheus/OpenTelemetry), log có cấu trúc, cảnh báo khi `recordUsage` thất bại.
12. Dọn repo: ignore `.claude/`, xoá `data/*.db`, thống nhất package manager, hợp nhất tài liệu.

## 6. Kết luận

Hệ thống có **thiết kế dữ liệu và code chất lượng tốt**, đặc biệt phần API key/audit/usage. Tuy nhiên **thiếu lớp xác thực cho toàn bộ bề mặt quản trị và gửi mail** khiến cơ chế API key trên thực tế có thể bị bỏ qua. Cần xử lý nhóm C1–C4 trước mọi triển khai công khai; sau đó thống nhất schema/migration và bổ sung kiểm thử.

> [!NOTE]
> Đánh giá dựa trên đọc tĩnh mã nguồn; chưa chạy ứng dụng, chưa chạy typecheck/test, chưa kiểm tra nội dung `.env` hay các script Kafka trong `server/scripts`, `client/src/components`.

