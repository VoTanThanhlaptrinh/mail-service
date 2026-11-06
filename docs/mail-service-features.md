# Mail Service: các chức năng cần có để gửi email và kiểm soát quota theo API key

Tài liệu này liệt kê các chức năng mail-service cần có để:

1. **Gửi email** cho các hệ thống khác qua REST API.
2. **Kiểm soát lượng sử dụng** của từng API key (rate limit, quota ngày/tháng, giới hạn kích thước).

Mỗi chức năng đều ghi rõ là **đã có** hay **còn thiếu** trong code hiện tại, xếp theo mức ưu tiên (P0 → P2), kèm đề xuất về dữ liệu, API và cách triển khai.

---

## 1. Hiện trạng

| Thành phần | Trạng thái | Ghi chú |
| :--- | :--- | :--- |
| Bảng `mails` (`QUEUED` / `SENT` / `FAILED`) | ✅ Đã có | Chỉ có một người nhận (`to`), nội dung dạng `text` |
| Bảng `api_keys` (hash SHA-256, prefix, last4, scopes, expires, revoke, soft delete) | ✅ Đã có | Scope mặc định là `mail:send` |
| Bảng `api_key_usage_logs` (append-only) | ✅ Đã có | Mỗi lần gọi có một dòng `SUCCESS` / `FAILED` / `REJECTED` |
| Bảng `audit_logs` (trigger) | ✅ Đã có | Ghi lại vòng đời của API key |
| Middleware `optionalApiKey` | ⚠️ Một phần | **Không có header thì request vẫn được xử lý** như lời gọi nội bộ, nên **đi vòng qua được mọi quota** |
| Gửi email thật (SMTP / provider) | ❌ Chưa có | Chưa có thư viện gửi mail trong dependencies |
| Hàng đợi và worker gửi lại | ❌ Chưa có | |
| Rate limit / quota theo key | ❌ Chưa có | Usage log mới chỉ ghi lại, chưa chặn |
| Idempotency, template, webhook, suppression list | ❌ Chưa có | |

> [!WARNING]
> Lỗ hổng lớn nhất hiện tại: `POST /api/mails` cho phép gọi **không cần API key**. Muốn kiểm soát quota thì mọi lời gọi gửi mail từ bên ngoài **bắt buộc** phải có key (xem mục 3.1).

---

## 2. Nhóm chức năng gửi email

### 2.1. P0: bắt buộc phải có

| # | Chức năng | Mô tả |
| :- | :--- | :--- |
| S1 | **API gửi email** `POST /api/v1/mails` | Nhận `from`, `to[]`, `cc[]`, `bcc[]`, `subject`, `text`, `html`, `replyTo`. Validate bằng `zod` ngay ở entry point |
| S2 | **Gửi bất đồng bộ (queue)** | API chỉ ghi `QUEUED` rồi trả về `202 Accepted` kèm `mailId`. Worker sẽ lấy mail và gửi qua provider |
| S3 | **Lớp provider (adapter)** | Interface `MailProvider.send()`, có các bản cài đặt SMTP / SES / SendGrid… Thông tin đăng nhập lấy từ biến môi trường (env), **không hardcode** |
| S4 | **Retry có backoff** | Lỗi tạm thời (4xx của SMTP, timeout) thì thử lại theo exponential backoff, tối đa N lần. Lỗi vĩnh viễn (5xx, địa chỉ không hợp lệ) thì `FAILED` luôn |
| S5 | **Tra cứu trạng thái** `GET /api/v1/mails/:id` | Key chỉ xem được mail **do chính nó gửi** (`api_key_id` trên `mails`) |
| S6 | **Idempotency** | Header `Idempotency-Key`: gọi lại cùng key trong 24h thì trả kết quả cũ, không gửi trùng và **không trừ quota lần nữa** |
| S7 | **Domain người gửi được phép** | Mỗi API key chỉ được gửi từ các domain / địa chỉ `from` đã đăng ký, để chống giả mạo người gửi |

### 2.2. P1: nên có

| # | Chức năng | Mô tả |
| :- | :--- | :--- |
| S8 | **Template email** | `templateId` + `variables`, render phía server, có lưu version |
| S9 | **File đính kèm** | Base64 hoặc URL, giới hạn tổng dung lượng (ví dụ 10 MB) và whitelist MIME type |
| S10 | **Gửi theo lô** `POST /api/v1/mails/batch` | Tối đa X mail mỗi request, trả về kết quả từng mail. Quota trừ theo **số mail** chứ không theo số request |
| S11 | **Hẹn giờ gửi** | `scheduledAt`: worker chỉ lấy mail khi `scheduled_at <= now()` |
| S12 | **Suppression list** | Tự chặn các địa chỉ đã bounce cứng hoặc đã báo spam / unsubscribe |
| S13 | **Webhook sự kiện** | Gọi về URL của khách các sự kiện `sent`, `delivered`, `bounced`, `failed`, có ký HMAC |

### 2.3. P2: mở rộng

- Tracking open / click (pixel và redirect link).
- Header `List-Unsubscribe` và trang unsubscribe.
- Hướng dẫn cấu hình SPF / DKIM / DMARC cho domain người gửi.
- Gửi qua nhiều provider, tự chuyển sang provider khác (failover) khi một provider lỗi.

---

## 3. Nhóm chức năng kiểm soát quota theo API key

### 3.1. P0: bắt buộc phải có

| # | Chức năng | Mô tả |
| :- | :--- | :--- |
| Q1 | **Bắt buộc API key cho API công khai** | Tách 2 nhóm route: `/api/v1/*` (public, **bắt buộc** Bearer key) và `/api/admin/*` (UI quản trị, xác thực riêng) |
| Q2 | **Kiểm tra scope** | Middleware `requireScope('mail:send')` trả `403 INSUFFICIENT_SCOPE` khi key không có quyền |
| Q3 | **Rate limit ngắn hạn** | Ví dụ 60 request/phút mỗi key, chống burst. Vượt mức thì trả `429 RATE_LIMITED` |
| Q4 | **Quota ngày / tháng** | Ví dụ 1.000 mail/ngày, 20.000 mail/tháng. Vượt mức thì trả `429 QUOTA_EXCEEDED` |
| Q5 | **Giới hạn trên mỗi mail** | Số người nhận tối đa (`to + cc + bcc`), kích thước body, kích thước đính kèm. Vượt thì trả `400` / `413` |
| Q6 | **Header phản hồi** | Trả `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `X-Quota-Remaining`. Khi `429` thì thêm `Retry-After` |
| Q7 | **Trừ quota nguyên tử (atomic)** | Kiểm tra và tăng bộ đếm trong **một câu SQL** để tránh race condition khi có nhiều request đồng thời |
| Q8 | **Ghi usage cho mọi kết quả** | `SUCCESS` / `FAILED` / `REJECTED` (bao gồm cả bị chặn vì quota, với `error_code = QUOTA_EXCEEDED`) |

### 3.2. P1: nên có

| # | Chức năng | Mô tả |
| :- | :--- | :--- |
| Q9 | **Gói (plan)** | `FREE`, `PRO`, `ENTERPRISE` định nghĩa sẵn các giới hạn. Key thuộc một plan, có thể ghi đè (override) từng giới hạn riêng |
| Q10 | **API xem quota** `GET /api/v1/quota` | Key tự xem đã dùng bao nhiêu và còn lại bao nhiêu trong kỳ hiện tại |
| Q11 | **Dashboard usage** | Biểu đồ theo ngày cho từng key: số mail gửi, tỉ lệ lỗi, số lần bị chặn |
| Q12 | **Cảnh báo ngưỡng** | Khi dùng tới 80% / 100% quota thì gửi email / webhook cho chủ key |
| Q13 | **Điều chỉnh quota thủ công** | Admin tăng / giảm hạn mức hoặc reset bộ đếm. Mọi thay đổi đều ghi vào `audit_logs` |

### 3.3. P2: mở rộng

- Quota theo **người nhận** thay vì theo mail (với batch, hoặc mail có nhiều `bcc`).
- Giới hạn theo IP whitelist cho từng key.
- Tự động tạm khoá key khi tỉ lệ bounce hoặc spam vượt ngưỡng.
- Tính tiền phần dùng vượt hạn mức (overage billing).

---

## 4. Thiết kế dữ liệu đề xuất

> [!IMPORTANT]
> Đây là **đề xuất**, chưa được áp dụng. Thay đổi schema phải qua review rồi mới tạo migration `0003_*.sql` và cập nhật [schema.ts](../server/src/schema.ts).

```mermaid
erDiagram
    plans ||--o{ api_keys : "thuoc"
    api_keys ||--o{ api_key_limits : "override"
    api_keys ||--o{ api_key_quota_counters : "dem"
    api_keys ||--o{ mails : "gui"
    api_keys ||--o{ api_key_usage_logs : "ghi log"
    api_keys ||--o{ idempotency_keys : "chong trung"

    plans {
        text code PK
        int rate_per_minute
        int daily_quota
        int monthly_quota
        int max_recipients
        int max_body_bytes
    }
    api_key_limits {
        uuid api_key_id PK
        int rate_per_minute
        int daily_quota
        int monthly_quota
        int max_recipients
    }
    api_key_quota_counters {
        uuid api_key_id PK
        text period PK
        timestamptz window_start PK
        int used
    }
    idempotency_keys {
        uuid api_key_id PK
        text key PK
        uuid mail_id
        timestamptz expires_at
    }
```

Các thay đổi trên bảng hiện có:

| Bảng | Cột thêm | Mục đích |
| :--- | :--- | :--- |
| `api_keys` | `plan_code text NOT NULL DEFAULT 'FREE'` | Liên kết với gói |
| `api_keys` | `allowed_senders text[]` | Danh sách domain / địa chỉ `from` được phép (S7) |
| `mails` | `api_key_id uuid NULL` | Biết mail nào do key nào gửi (S5) |
| `mails` | `from`, `cc`, `bcc`, `html`, `attempts`, `next_attempt_at`, `scheduled_at`, `provider_message_id` | Phục vụ queue, retry và hẹn giờ |

**Cách tính giới hạn hiệu lực**: `COALESCE(api_key_limits.x, plans.x)`. Giá trị `NULL` ở cả hai nơi nghĩa là không giới hạn.

---

## 5. Luồng xử lý một request gửi mail

```mermaid
flowchart TD
    A["POST /api/v1/mails"] --> B{"Co Bearer key hop le?"}
    B -- Khong --> R401["401 INVALID_API_KEY"]
    B -- Co --> C{"Key ACTIVE va chua het han?"}
    C -- Khong --> R401b["401 API_KEY_REVOKED / EXPIRED"]
    C -- Co --> D{"Co scope mail:send?"}
    D -- Khong --> R403["403 INSUFFICIENT_SCOPE"]
    D -- Co --> E{"Body hop le va trong gioi han?"}
    E -- Khong --> R400["400 / 413 VALIDATION_ERROR"]
    E -- Co --> F{"Idempotency-Key da ton tai?"}
    F -- Co --> R200["Tra lai ket qua cu, khong tru quota"]
    F -- Khong --> G{"Rate limit / phut con?"}
    G -- Het --> R429a["429 RATE_LIMITED + Retry-After"]
    G -- Con --> H{"Quota ngay / thang con?"}
    H -- Het --> R429b["429 QUOTA_EXCEEDED"]
    H -- Con --> I["Transaction: insert mails QUEUED + tang counter + usage SUCCESS"]
    I --> J["202 Accepted + mailId + header quota"]
    J --> K["Worker gui qua provider, retry neu loi tam thoi"]
```

**Nguyên tắc thứ tự**: kiểm tra những gì **rẻ và không tốn quota** trước (auth → scope → validate → idempotency), sau đó mới trừ quota. Như vậy request sai định dạng sẽ không làm hao quota của khách.

---

## 6. Trừ quota nguyên tử (Q7)

Dùng một câu `UPSERT` có điều kiện. Nếu câu lệnh **không trả về dòng nào** thì nghĩa là đã hết quota:

```sql
INSERT INTO api_key_quota_counters (api_key_id, period, window_start, used)
VALUES ($1, $2, $3, $4)
ON CONFLICT (api_key_id, period, window_start)
DO UPDATE SET used = api_key_quota_counters.used + EXCLUDED.used
WHERE api_key_quota_counters.used + EXCLUDED.used <= $5
RETURNING used;
```

- `$2`: `'MINUTE'` | `'DAY'` | `'MONTH'`
- `$3`: đầu cửa sổ thời gian (`date_trunc('day', now())`, …)
- `$4`: số mail cần trừ (bằng 1, hoặc bằng số mail trong batch)
- `$5`: giới hạn hiệu lực

Phác thảo service (theo đúng quy ước guard clause + throw của project):

```ts
export async function consumeQuota(tx: Tx, apiKeyId: string, amount: number): Promise<QuotaSnapshot> {
  if (amount <= 0) throw new HttpError(400, 'Quota amount must be positive');

  const limits = await getEffectiveLimits(tx, apiKeyId);
  const windows = buildWindows(limits, new Date()); // MINUTE, DAY, MONTH (bỏ qua giới hạn null)

  for (const window of windows) {
    const used = await incrementCounter(tx, apiKeyId, window, amount);
    if (used === null) throw new QuotaExceededError(window);
  }

  return snapshot(limits, windows);
}
```

- Hàm được gọi **trong cùng transaction** với lệnh insert vào `mails`. Nếu bước nào lỗi thì toàn bộ rollback, không có tình trạng bị trừ quota mà mail lại không được tạo.
- `QuotaExceededError` được map thành `429` ở `errorHandler` trung tâm. Handler này cũng chịu trách nhiệm set các header `Retry-After` / `X-RateLimit-*`.
- Khi bị chặn, ghi usage `REJECTED` **ngoài** transaction đã rollback để log không bị mất.

> [!TIP]
> Postgres đáp ứng tốt cho mức vài trăm request/giây. Khi cần rate limit theo phút ở tải cao hơn, có thể chuyển riêng bộ đếm `MINUTE` sang Redis (`INCR` + `EXPIRE`) và giữ quota ngày / tháng trong Postgres để đối soát.

**Chính sách tính quota** (cần chốt với nghiệp vụ):

| Tình huống | Đề xuất |
| :--- | :--- |
| Request sai định dạng (400) | Không trừ |
| Bị chặn vì rate limit / quota (429) | Không trừ |
| Mail đã nhận (`QUEUED`) nhưng provider gửi lỗi (`FAILED`) | **Có trừ** (đã dùng tài nguyên). Tuỳ chọn hoàn lại nếu lỗi do hệ thống |
| Gọi lại với cùng `Idempotency-Key` | Không trừ |

---

## 7. Danh sách API đề xuất

### 7.1. Public API (bắt buộc Bearer key)

| Method | Path | Scope | Mô tả |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/mails` | `mail:send` | Gửi một email |
| `POST` | `/api/v1/mails/batch` | `mail:send` | Gửi theo lô |
| `GET` | `/api/v1/mails/:id` | `mail:read` | Xem trạng thái mail do chính key gửi |
| `GET` | `/api/v1/quota` | (bất kỳ) | Xem quota còn lại |

### 7.2. Admin API (UI quản trị)

| Method | Path | Mô tả |
| :--- | :--- | :--- |
| `GET/POST/PATCH` | `/api/admin/api-keys` | Quản lý key (đã có ở `/api/api-keys`) |
| `GET/PUT` | `/api/admin/api-keys/:id/limits` | Xem / ghi đè giới hạn của key |
| `POST` | `/api/admin/api-keys/:id/quota/reset` | Reset bộ đếm (có ghi audit) |
| `GET/POST/PATCH` | `/api/admin/plans` | Quản lý gói |
| `GET` | `/api/admin/usage?apiKeyId=&from=&to=` | Thống kê usage theo ngày |
| `GET` | `/api/admin/audit-logs` | Đã có ở `/api/audit-logs` |

### 7.3. Ví dụ request / response

```http
POST /api/v1/mails
Authorization: Bearer msk_live_xxxxxxxxxxxx
Idempotency-Key: 7f1c2a9e-order-1001
Content-Type: application/json

{
  "from": "no-reply@shop.example.com",
  "to": ["customer@example.com"],
  "subject": "Xác nhận đơn hàng #1001",
  "html": "<p>Cảm ơn bạn đã đặt hàng</p>"
}
```

```http
HTTP/1.1 202 Accepted
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 59
X-RateLimit-Reset: 1793722740
X-Quota-Daily-Remaining: 999
X-Quota-Monthly-Remaining: 19999

{ "id": "b3e1…", "status": "QUEUED" }
```

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 3600

{ "error": { "code": "QUOTA_EXCEEDED", "message": "Daily quota of 1000 emails exceeded", "period": "DAY" } }
```

---

## 8. Bảng mã lỗi chuẩn

| HTTP | `code` | Khi nào |
| :--- | :--- | :--- |
| 400 | `VALIDATION_ERROR` | Body sai schema |
| 400 | `TOO_MANY_RECIPIENTS` | Vượt `max_recipients` |
| 401 | `INVALID_API_KEY` | Thiếu key / sai định dạng / không tồn tại |
| 401 | `API_KEY_REVOKED` / `API_KEY_EXPIRED` | Key không còn hiệu lực (đã có) |
| 403 | `INSUFFICIENT_SCOPE` | Thiếu scope |
| 403 | `SENDER_NOT_ALLOWED` | `from` không thuộc danh sách được phép |
| 409 | `IDEMPOTENCY_CONFLICT` | Cùng `Idempotency-Key` nhưng body khác |
| 413 | `PAYLOAD_TOO_LARGE` | Vượt kích thước body / đính kèm |
| 422 | `RECIPIENT_SUPPRESSED` | Người nhận nằm trong suppression list |
| 429 | `RATE_LIMITED` | Vượt rate limit ngắn hạn |
| 429 | `QUOTA_EXCEEDED` | Vượt quota ngày / tháng |

---

## 9. Lộ trình triển khai đề xuất

```mermaid
flowchart LR
    P1["Giai doan 1: Bao mat va quota co ban - Q1 Q2 Q4 Q5 Q6 Q7 Q8"] --> P2["Giai doan 2: Gui that - S1 S2 S3 S4 S5"]
    P2 --> P3["Giai doan 3: On dinh - S6 S7 Q3 Q9 Q10"]
    P3 --> P4["Giai doan 4: Van hanh - S8-S13 Q11-Q13"]
```

| Giai đoạn | Kết quả bàn giao | Thay đổi chính |
| :--- | :--- | :--- |
| 1 | Không thể gửi mail khi không có key; key bị chặn khi hết quota | Migration `0003_quota.sql`, middleware `requireApiKey` + `requireScope`, service `consumeQuota`, `QuotaExceededError` trong `errorHandler` |
| 2 | Email được gửi thật qua provider, có retry | `MailProvider` adapter, worker lấy job bằng `SELECT … FOR UPDATE SKIP LOCKED`, thêm cột retry vào `mails` |
| 3 | Không gửi trùng, không giả mạo người gửi, có gói dịch vụ | Bảng `idempotency_keys`, `plans`, cột `allowed_senders` |
| 4 | Dashboard, cảnh báo, template, webhook | UI bổ sung, bảng `templates`, `webhooks`, `suppressions` |

---

## 10. Checklist nghiệm thu

- [ ] Gọi `POST /api/v1/mails` không có key thì nhận `401`.
- [ ] Key thiếu scope `mail:send` thì nhận `403`.
- [ ] Gửi 1001 mail/ngày với quota 1000 thì mail thứ 1001 nhận `429 QUOTA_EXCEEDED` và có usage log `REJECTED`.
- [ ] 50 request đồng thời với quota còn 10 thì **đúng 10** request thành công (kiểm tra tính nguyên tử).
- [ ] Gửi lại cùng `Idempotency-Key` thì không tạo mail mới và quota không đổi.
- [ ] Mọi response thành công đều có header `X-RateLimit-*` / `X-Quota-*`.
- [ ] Thay đổi giới hạn / reset quota đều xuất hiện trong `audit_logs`.
- [ ] Không có secret (API key thô, mật khẩu SMTP) trong log hoặc trong `audit_logs`.
