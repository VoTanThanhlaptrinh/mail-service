# Mail Service: các điểm cần cải thiện (hiệu năng, thiết kế, logic)

Tài liệu này là kết quả rà soát **code hiện tại** (server Express + Drizzle + libSQL, client React). Nó bổ sung cho hai tài liệu đã có:

- [mail-service-features.md](mail-service-features.md): chức năng gửi mail **S1–S13** và quota **Q1–Q13**.
- [mail-service-requirements-next.md](mail-service-requirements-next.md): nhóm **A–I** (xác thực admin, sandbox, vòng đời mail, domain, dữ liệu, UI, tài liệu API, vận hành, chất lượng).

Những mục đã có ở hai tài liệu trên chỉ được **tham chiếu mã**, không chép lại. Trọng tâm ở đây là lỗi logic, điểm nghẽn hiệu năng và chỗ thiết kế bị lệch giữa code, schema và tài liệu.

**Mức độ:** 🔴 nên sửa ngay · 🟠 nên sửa trước khi có tải thật · 🟡 cải thiện dần.

---

## 0. Tóm tắt

| # | Vấn đề | Loại | Mức |
| :- | :--- | :--- | :- |
| L1 | Gửi mail không cần API key qua `/mails/:id/send` và `/mails/bulk` | Logic / bảo mật | 🔴 |
| L2 | Hai request gửi cùng một mail có thể gửi trùng | Logic | 🔴 |
| L3 | `api_keys.updated_at`, `updated_by` không bao giờ được cập nhật | Logic | 🔴 |
| L4 | Kết quả bulk: response `201` nhưng usage log ghi `502`; chỉ lưu `mailId` đầu tiên | Logic | 🟠 |
| L5 | JSON lỗi cú pháp hoặc body quá lớn trả `500` thay vì `400`/`413` | Logic | 🟠 |
| L6 | Biến template không giới hạn độ dài; body sau khi render không được kiểm tra | Logic | 🟠 |
| L7 | `PATCH /mails/:id` cho đặt `SENT` tay, không xoá `sentAt` khi quay về `QUEUED` | Logic | 🟠 |
| L8 | Revoke/patch API key kiểm tra trạng thái ngoài transaction (TOCTOU) | Logic | 🟡 |
| L9 | `last_used_at` được cập nhật cả khi request bị `REJECTED` | Logic | 🟡 |
| P1 | Gửi hàng loạt tuần tự: 100 lần SMTP + 100 lần UPDATE trong một request | Hiệu năng | 🔴 |
| P2 | Transaction tương tác trên Turso tốn nhiều round-trip | Hiệu năng | 🟠 |
| P3 | Danh sách mail trả nguyên `body` (tới 20 KB/mail) | Hiệu năng | 🟠 |
| P4 | SQLite cục bộ chưa bật WAL và `busy_timeout` | Hiệu năng | 🟠 |
| P5 | Timestamp lưu theo giây: thứ tự không ổn định, lọc thời gian thô | Hiệu năng / logic | 🟠 |
| P6 | Index chưa khớp truy vấn lọc + sắp xếp; `LIKE '%x%'` quét toàn bảng | Hiệu năng | 🟡 |
| P7 | SMTP transporter không dùng pool | Hiệu năng | 🟡 |
| D1 | Schema khai báo ở 2 nơi; thư mục `migrations/` là SQL Postgres đã chết | Thiết kế | 🔴 |
| D2 | Tài liệu, comment và UI vẫn nói Postgres/trigger | Thiết kế | 🟠 |
| D3 | Route handler gánh hết nghiệp vụ, lặp code ghi usage | Thiết kế | 🟠 |
| D4 | `mails` không lưu `api_key_id`, `message_id` | Thiết kế | 🟠 |
| D5 | Logic template bị lặp giữa client và server | Thiết kế | 🟡 |
| F1–F6 | Lỗi và hạn chế phía client | Frontend | 🟠/🟡 |

---

## 1. Logic

### L1 🔴 Gửi mail không cần API key

`POST /api/mails/send` và `/send-bulk` bắt buộc key ([mails.ts:132](../server/src/routes/mails.ts:132), [mails.ts:271](../server/src/routes/mails.ts:271)). Nhưng ai cũng làm được việc tương đương mà không cần key:

- `POST /api/mails` (không auth) rồi `POST /api/mails/:id/send` với `optionalApiKey` ([mails.ts:384](../server/src/routes/mails.ts:384)).
- `POST /api/mails/bulk` với `optionalApiKey`, `sendNow: true` mặc định ([mails.ts:311](../server/src/routes/mails.ts:311)): **100 mail/request, không key, không ghi usage**.

Kết quả là service đang là **open relay** cho bất kỳ ai gọi được cổng API. Nhóm A (A1–A2) giải quyết tận gốc, nhưng trước khi có đăng nhập admin nên vá tạm:

- Cấu hình `ADMIN_TOKEN` trong env và middleware `requireAdminToken` cho mọi route không phải `/send`, `/send-bulk`, `/health`.
- Hoặc tối thiểu: chỉ cho route admin nhận request từ `localhost`/mạng nội bộ khi `NODE_ENV=production`.

### L2 🔴 Gửi trùng khi hai request chạy song song

`POST /mails/:id/send` đọc mail, thấy chưa `SENT`, rồi mới gửi SMTP ([mails.ts:401-425](../server/src/routes/mails.ts:401)). Hai request gần nhau (bấm đúp, client retry) đều vượt qua kiểm tra và **cùng gửi**.

Sửa: "nhận việc" bằng một câu UPDATE nguyên tử trước khi gửi, kết hợp trạng thái `SENDING` (C2):

```sql
UPDATE mails SET status = 'SENDING', updated_at = ?
WHERE id = ? AND status IN ('QUEUED', 'FAILED')
RETURNING *;
```

Không có dòng trả về thì trả `409`. Cùng cơ chế này dùng lại được cho worker (S2) vì **SQLite không có `FOR UPDATE SKIP LOCKED`** như tài liệu cũ mô tả.

### L3 🔴 `updated_at` / `updated_by` của API key bị đứng yên

Ở bản Postgres, trigger `fn_set_audit_actor` tự cập nhật hai cột này. Bản SQLite bỏ trigger, nhưng các route `PATCH`, `revoke`, `rotate`, `DELETE` ([api-keys.ts:166-304](../server/src/routes/api-keys.ts:166)) không tự set. Vì vậy UI và API luôn hiển thị `updatedAt` = thời điểm tạo và `updatedBy` = người tạo.

Sửa: thêm `.$onUpdateFn(() => new Date())` cho `updatedAt` trong [schema.ts](../server/src/schema.ts), và set `updatedBy: context.actor` ở mỗi lệnh update. Kiểm tra tương tự cho `mails.updatedAt` (hiện đang set tay, dễ quên).

### L4 🟠 Kết quả gửi hàng loạt không nhất quán

- Khi **toàn bộ** batch lỗi, usage log ghi `FAILED 502` ([mails.ts:249-257](../server/src/routes/mails.ts:249)) nhưng client nhận `201` ([mails.ts:305](../server/src/routes/mails.ts:305)). Nên trả `207 Multi-Status`, hoặc `200` kèm tổng kết, và dùng cùng một mã cho cả hai nơi.
- Gửi một phần thành công vẫn ghi `SUCCESS`, không lưu số lượng. Usage log chỉ giữ `mailId` của mail đầu tiên nên 99 mail còn lại không truy ngược được về key. Nên ghi `metadata: { total, sent, failed, mailIds }` (cột `metadata` đã có nhưng chưa dùng), hoặc giải quyết bằng D4.
- `queuedCount: 0` cố định trong `executeBulkSend` ([mails.ts:237](../server/src/routes/mails.ts:237)) là thừa.

### L5 🟠 Lỗi parse body trả `500`

`express.json()` ném lỗi có `type: 'entity.parse.failed'` (400) hoặc `'entity.too.large'` (413). [error-handler.ts](../server/src/middleware/error-handler.ts) chỉ nhận `ZodError` và `HttpError`, nên các lỗi này rơi vào nhánh `500 Internal server error` và in stack trace ra log. Thêm nhánh: nếu `err.status` là số 4xx thì trả đúng status đó.

Nên map luôn lỗi ràng buộc của libSQL (`SQLITE_CONSTRAINT`) sang `409` thay vì `500`.

### L6 🟠 Template: biến không giới hạn, body sau render không được kiểm tra

- `variables: z.record(z.string(), z.string())` ([mails.ts:25](../server/src/routes/mails.ts:25)) không giới hạn số khoá hay độ dài giá trị. Body template ≤ 20 000 ký tự nhưng **sau khi render** có thể dài tuỳ ý. Subject ≤ 200 cũng chỉ kiểm tra trước khi render.
- Nên giới hạn: tối đa 50 biến, mỗi giá trị ≤ 1 000 ký tự, và kiểm tra lại độ dài subject/body sau khi render.
- `renderRecipientMails` dừng ở người nhận lỗi đầu tiên ([template.ts:75](../server/src/services/template.ts:75)). Nên gom lỗi của **mọi** người nhận để UI tô đỏ cùng lúc.
- Biến chỉ thừa (có trong `variables` nhưng không có trong template) bị bỏ qua lặng lẽ. Có thể trả cảnh báo.

### L7 🟠 `PATCH /mails/:id` phá máy trạng thái

([mails.ts:456](../server/src/routes/mails.ts:456)) cho phép đặt `SENT` mà không gửi gì, và khi đổi `SENT` → `QUEUED` thì `sentAt` cũ vẫn giữ. Đã có trong C2; trong lúc chờ, ít nhất nên: chỉ cho `FAILED → QUEUED` (đưa lại hàng đợi), xoá `sentAt`/`error` khi quay về `QUEUED`, và chặn đặt `SENT` từ ngoài.

### L8 🟡 Kiểm tra trạng thái ngoài transaction

Revoke, rotate và patch đọc `existing` bằng `findApiKeyOrThrow` **trước** transaction ([api-keys.ts:203](../server/src/routes/api-keys.ts:203), [api-keys.ts:239](../server/src/routes/api-keys.ts:239)). Hai lệnh revoke đồng thời đều qua được kiểm tra `status === 'REVOKED'` và sinh hai dòng audit; rotate có thể chạy trên key vừa bị revoke. Sửa bằng điều kiện trong chính câu UPDATE (`WHERE id = ? AND status = 'ACTIVE' AND deleted_at IS NULL`), không có dòng trả về thì trả `409`. Snapshot `before` của audit cũng nên đọc trong transaction.

### L9 🟡 `last_used_at` bị cập nhật khi request bị từ chối

`recordUsage` luôn update `last_used_at` ([services/usage.ts:53](../server/src/services/usage.ts:53)), kể cả `REJECTED` (key hết hạn, sai scope). Như vậy key đã thu hồi mà bên ngoài còn cố dùng sẽ trông như "vẫn đang được dùng". Nên chỉ cập nhật khi outcome khác `REJECTED`, hoặc tách thành hai cột `last_used_at` và `last_rejected_at`.

### Ghi chú nhỏ

- `withAudit(context, work)` bỏ qua tham số `context` ([lib/audit.ts:47](../server/src/lib/audit.ts:47)). Hoặc dùng nó để tự gọi `recordAudit`, hoặc đổi tên thành `inTransaction`.
- Comment trong [services/usage.ts:29-31](../server/src/services/usage.ts:29) nhắc tới "append-only trigger" nhưng SQLite không có trigger nào. Nếu cần append-only, thêm trigger SQLite `BEFORE UPDATE/DELETE ... RAISE(ABORT, ...)` cho `api_key_usage_logs` và `audit_logs`.
- `LIKE` không escape `%` và `_` trong từ khoá tìm kiếm ([mails.ts:98](../server/src/routes/mails.ts:98), [api-keys.ts:128](../server/src/routes/api-keys.ts:128)). Tìm `a_b` sẽ khớp `axb`.

---

## 2. Hiệu năng

### P1 🔴 Gửi hàng loạt chạy tuần tự trong request

`executeBulkSend` ([mails.ts:210-233](../server/src/routes/mails.ts:210)) lặp 100 lần: `await` SMTP rồi `await` UPDATE. Với SMTP thật (200–800 ms/mail), một batch mất 20–80 giây:

- Vượt `maxDuration: 60` trên Vercel ([vercel.json](../vercel.json)) → request bị cắt giữa chừng, mail còn lại kẹt ở `QUEUED`.
- Client bị treo suốt thời gian đó.

Lộ trình:

1. **Ngắn hạn:** giới hạn đồng thời (ví dụ 5 mail cùng lúc bằng một hàm `mapWithConcurrency` tự viết, không cần thư viện), dùng transporter có pool (P7), và gom các UPDATE kết quả vào một `db.batch([...])`.
2. **Đúng hướng:** S2: API chỉ insert `QUEUED` rồi trả `202` kèm `batchId`; worker xử lý. Trên Vercel không có process chạy nền, nên worker cần Vercel Cron hoặc một queue bên ngoài (QStash, Upstash). Với Docker thì chạy worker trong cùng process.

### P2 🟠 Transaction tương tác trên Turso

Với Turso, mỗi câu lệnh là một round-trip mạng, và `db.transaction(async tx => …)` thêm `BEGIN`/`COMMIT`. Một lần gọi `/send` hiện tốn khoảng:

| Bước | Round-trip |
| :--- | :-: |
| Tra key theo hash | 1 |
| Insert mail | 1 |
| Update `SENT` | 1 |
| `recordUsage` (BEGIN, insert, update, COMMIT) | 4 |

Đề xuất:

- `recordUsage` và các `withAudit` chỉ gồm câu lệnh ghi không phụ thuộc kết quả của nhau → dùng `db.batch([...])` (atomic, 1 round-trip).
- Ghi usage log **sau khi trả response** (`res.on('finish')`), vì nó không ảnh hưởng kết quả. Trên Vercel cần `waitUntil` để không bị cắt.
- Cache kết quả tra key (LRU, TTL 30–60 giây, xoá khi revoke/rotate). Chấp nhận độ trễ revoke tối đa bằng TTL, hoặc chỉ cache khi chạy một instance.

### P3 🟠 Danh sách mail trả nguyên body

`GET /mails` trả đầy đủ `body` cho 50 mail ([mails.ts:105](../server/src/routes/mails.ts:105)), tới khoảng 1 MB/trang, trong khi UI chỉ cần đoạn đầu. Chọn cột cụ thể và trả `bodyPreview: substr(body, 1, 200)`; body đầy đủ lấy qua `GET /mails/:id` khi mở chi tiết (F1 bên dưới).

### P4 🟠 SQLite cục bộ chưa bật WAL, `busy_timeout`

[db.ts:47-50](../server/src/db.ts:47) chỉ bật `foreign_keys`. Comment trong `docker-compose.yml` nhắc tới WAL nhưng WAL chưa từng được bật. Nên thêm cho file cục bộ:

```sql
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
PRAGMA synchronous = NORMAL;
```

WAL cho phép đọc trong lúc ghi; `busy_timeout` tránh lỗi `SQLITE_BUSY` khi các transaction chồng nhau (`client.transaction()` của libSQL mở kết nối riêng).

### P5 🟠 Timestamp theo giây

`integer(..., { mode: 'timestamp' })` lưu **giây** ([schema.ts:19-25](../server/src/schema.ts:19)). Hệ quả:

- Mail của cùng một batch có cùng `created_at` → `ORDER BY created_at DESC` cho thứ tự không xác định. Phân trang `offset` có thể lặp hoặc bỏ sót dòng.
- `durationMs` có độ chính xác ms nhưng `createdAt` của usage log thì không.

Sửa: chuyển sang `mode: 'timestamp_ms'` (cần migration nhân giá trị cũ với 1000), và luôn thêm khoá phụ vào `ORDER BY` (`created_at DESC, id DESC`). Cân nhắc dùng **UUIDv7** cho `id`: sắp xếp theo thời gian, chèn vào B-tree gần nhau hơn UUIDv4, và là khoá phụ tự nhiên cho cursor.

### P6 🟡 Index và tìm kiếm

- Lọc `status` + sắp theo `created_at` cần index ghép `(status, created_at)`; hiện chỉ có hai index đơn ([schema.ts:28-30](../server/src/schema.ts:28)).
- Usage log lọc theo key + outcome: thêm `(api_key_id, outcome, created_at)`.
- `LIKE '%x%'` luôn quét toàn bảng. Khi dữ liệu lớn: dùng FTS5 cho `to`/`subject`, hoặc ít nhất tìm theo tiền tố (`LIKE 'x%'`) cho cột `to`.
- `COUNT(*)` chạy ở mọi lần list. Với bảng lớn nên chuyển sang **keyset pagination** (`?cursor=`), chỉ trả `hasMore` và đếm tổng khi được yêu cầu.

### P7 🟡 SMTP transporter không pool

[mailer.ts:21-37](../server/src/services/mailer.ts:21) tạo transporter thường: mỗi mail mở một kết nối TCP/TLS mới. Bật `pool: true, maxConnections: 5, maxMessages: 100` khi chạy Docker/server lâu dài. Trên serverless thì không cần, nên đọc từ env.

---

## 3. Thiết kế

### D1 🔴 Schema ở hai nơi, migration Postgres đã chết

- Bảng được định nghĩa ở [schema.ts](../server/src/schema.ts) (Drizzle) **và** bằng SQL tay trong [migrate.ts](../server/src/migrate.ts). Hai bản đã lệch nhau: `key_hash` dùng `UNIQUE` ở cột trong một bản và `uniqueIndex` ở bản kia; index trong `migrate.ts` không có `DESC`.
- `migrate.ts` chỉ biết `CREATE TABLE IF NOT EXISTS`: **không thêm cột được** cho bảng đã có. Mọi thay đổi trong tài liệu này (L3, P5, D4) đều cần migration thật.
- [server/migrations/](../server/migrations/) chứa SQL **Postgres** (`CREATE TYPE`, `plpgsql`, `inet`, `jsonb`) không còn chạy được, gây hiểu nhầm rằng audit đang được ghi bằng trigger.

Sửa: dùng `drizzle-kit generate` để sinh migration SQLite có version từ `schema.ts`, chạy bằng `migrate()` của `drizzle-orm/libsql/migrator`; xoá hoặc chuyển `migrations/*.sql` cũ sang `docs/archive/`.

### D2 🟠 Tài liệu và UI vẫn mô tả Postgres

- Header UI ghi "React · Node.js · PostgreSQL" ([App.tsx:78](../client/src/App.tsx:78)); footer gắn cứng `localhost:4000/5173` ([App.tsx:122](../client/src/App.tsx:122)), sai khi chạy Docker hoặc Vercel.
- README nói audit trail "do trigger ghi lại"; hai tài liệu yêu cầu dựa trên Postgres (`FOR UPDATE SKIP LOCKED`, `argon2id … lưu ở Postgres`, `inet`).
- Root [package.json](../package.json) khai báo `engines.node >=20` trong khi server chạy `.ts` trực tiếp, cần Node 22.18+ (hoặc 22.6+ kèm cờ `--experimental-strip-types`).

Nên rà lại một lượt cho khớp với kiến trúc SQLite/Turso hiện tại.

### D3 🟠 Route handler gánh toàn bộ nghiệp vụ

[routes/mails.ts](../server/src/routes/mails.ts) (~480 dòng) trộn validate, ghi DB, gọi SMTP, ghi usage. Đoạn `safeParse` → `logMailUsage(FAILED 400)` → `throw` bị lặp 5 lần; `recordUsage` trong [api-key-auth.ts:53-81](../server/src/middleware/api-key-auth.ts:53) lặp 2 lần với cùng các trường request.

Đề xuất:

- Tầng `services/mail-service.ts` với `createMail`, `sendMail(id)`, `sendBulk(items)`; route chỉ parse input và trả kết quả. Worker (S2) sẽ dùng lại đúng các hàm này.
- Một middleware `trackUsage` gắn vào route cần ghi usage: ghi nhận `startedAt`, rồi ở `res.on('finish')` tự ghi outcome theo `res.statusCode` và `res.locals.mailIds`. Bỏ hết các lệnh `logMailUsage` thủ công trong từng nhánh lỗi.
- Hàm dựng `usageFromRequest(req)` để không lặp `requestId/ip/userAgent`.

### D4 🟠 `mails` thiếu liên kết và định danh từ provider

- Không có `api_key_id`: không trả lời được "key X đã gửi những mail nào" (đặc biệt với bulk, xem L4). Cần cho Q-quota và cho việc lọc mail theo key ở UI.
- `deliverMail` trả `messageId` nhưng giá trị bị bỏ đi ([mails.ts:150](../server/src/routes/mails.ts:150)). Cần cột `provider_message_id` để đối chiếu với log SMTP và webhook bounce (C1, S13).
- Thêm `batch_id` cho mail sinh từ một lần gửi hàng loạt.

### D5 🟡 Logic template bị lặp

Regex `{{var}}`, `extractVariables` và render tồn tại ở cả [template.ts](../server/src/services/template.ts) và [MailForm.tsx:17-41](../client/src/components/MailForm.tsx:17), với hành vi khác nhau (server thay biến thiếu bằng chuỗi rỗng, client giữ nguyên `{{key}}`). Tách thành package dùng chung trong workspace (`packages/shared`), kèm luôn các zod schema để client validate giống server.

### Ghi chú nhỏ

- Dockerfile dùng `npm install` thay vì `npm ci` (build không tái lập được); stage runner cài cả dependency của client (`react`, `react-dom`) dù chỉ cần server.
- `generateApiKey` chọn `live`/`test` theo `NODE_ENV` (đã nêu ở nhóm B).

---

## 4. Frontend

| # | Mức | Vấn đề | Đề xuất |
| :- | :- | :--- | :--- |
| F1 | 🟠 | Hộp thư chỉ tải 50 mail đầu, không có "tải thêm" dù hiển thị `total` ([MailboxPage.tsx:35](../client/src/components/MailboxPage.tsx:35)); `api.listMails` không nhận `limit/offset` | Thêm phân trang hoặc cuộn vô hạn như trang API key; mở chi tiết mail để xem body đầy đủ (đi cùng P3) |
| F2 | 🟠 | `loadMails` và `loadKeys` không chặn response cũ: đổi filter nhanh thì kết quả của filter trước có thể ghi đè | Dùng `AbortController` hoặc cờ `cancelled` như [ApiKeyDetailDialog.tsx](../client/src/components/ApiKeyDetailDialog.tsx) đã làm |
| F3 | 🟠 | Xoá mail không hỏi xác nhận ([MailItem.tsx:40](../client/src/components/MailItem.tsx:40)), trong khi API key có `ConfirmDialog` | Dùng lại `ConfirmDialog` |
| F4 | 🟡 | Danh sách người nhận bulk dùng `key={index}` ([MailForm.tsx:254](../client/src/components/MailForm.tsx:254)): xoá một dòng ở giữa làm focus nhảy; `previewIndex` trỏ sang người khác | Gán `id` ổn định cho mỗi dòng (`crypto.randomUUID()`) |
| F5 | 🟡 | Health check gọi mỗi 15 giây kể cả khi tab bị ẩn ([App.tsx:54](../client/src/App.tsx:54)) | Tạm dừng khi `document.visibilityState === 'hidden'` |
| F6 | 🟡 | Sau mỗi thao tác (gửi, xoá) đều tải lại toàn bộ danh sách | Cập nhật tại chỗ từ response (`api.sendMail` đã trả mail mới) |

---

## 5. Cụm tính năng đề xuất

Các tính năng lớn (queue, retry, idempotency, quota, webhook, domain, dashboard…) đã có trong S/Q/A–I. Dưới đây chỉ là những cụm **chưa được nhắc tới**, nhỏ và bám sát những gì UI đang có.

### Cụm 1: Gửi hàng loạt thực dụng hơn

- **Nhập người nhận từ CSV/Excel** (dán hoặc tải file): cột `email` cùng các cột biến, tự map vào `{{biến}}`, báo lỗi theo từng dòng. Nhập tay 100 dòng như hiện tại không khả thi.
- **Loại trùng và kiểm tra trước khi gửi**: phát hiện email lặp, email sai định dạng, biến thiếu, hiển thị bảng tổng kết trước khi bấm gửi (dùng kết quả gom lỗi ở L6).
- **Theo dõi batch**: `batch_id` (D4), trang tiến độ "đã gửi 37/100", nút "gửi lại các mail lỗi trong batch".

### Cụm 2: Soạn thảo an toàn

- **Gửi thử cho chính mình** trước khi gửi hàng loạt (render với dữ liệu của người nhận #1).
- **Nhân bản mail**: tạo mail mới từ một mail cũ (đặc biệt hữu ích với mail `FAILED`).
- **Lưu nháp cục bộ** (localStorage) để không mất nội dung khi lỡ tải lại trang.

### Cụm 3: Vòng đời API key an toàn hơn

- **Rotate có thời gian chuyển tiếp**: secret cũ còn hiệu lực N phút (mặc định 0) để bên tích hợp kịp đổi cấu hình, thay vì mất hiệu lực ngay ([ApiKeysPage.tsx:39](../client/src/components/ApiKeysPage.tsx:39)).
- **IP allowlist theo key**: chỉ chấp nhận request từ dải IP khai báo; ngoài dải thì ghi `REJECTED` với mã `IP_NOT_ALLOWED`.
- **Cảnh báo key sắp hết hạn và key không dùng**: badge trên UI cho key hết hạn trong 7 ngày, gợi ý thu hồi key không được dùng trong 90 ngày.

### Cụm 4: Chất lượng (bổ sung nhóm I)

- **Bộ test tích hợp** chạy trên SQLite `:memory:` (`createApp()` đã tách khỏi `listen` nên test bằng `supertest` rất dễ), bắt đầu bằng các ca hồi quy cho L1–L5 và L8.
- **SMTP giả trong test** bằng tham số `mailerTransporter` sẵn có của `deliverMail` (dùng `jsonTransport: true` của nodemailer).

---

## 6. Thứ tự gợi ý

1. **Vá ngay (một PR nhỏ):** L1 (token admin tạm thời), L3, L5, P4.
2. **Nền móng:** D1 (drizzle-kit migration), sau đó P5 + D4 trong cùng một migration.
3. **Gửi mail đúng và nhanh:** L2 + C2 (`SENDING`), P1 bước 1, P2, L4, D3.
4. **Frontend:** F1–F3, sau đó Cụm 1.
5. Phần còn lại theo lộ trình của hai tài liệu đã có.
