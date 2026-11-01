# Mail Service

Monorepo khởi tạo cho dịch vụ gửi mail: **React (Vite + TypeScript)** ở frontend, **Node.js (Express 5 + TypeScript)** ở backend và **PostgreSQL** làm cơ sở dữ liệu.

```
mail-service/
├─ client/                  # React 19 + Vite 8 + TypeScript
│  ├─ src/
│  │  ├─ components/        # MailForm, MailItem, StatusBadge
│  │  ├─ App.tsx            # layout + state
│  │  ├─ api.ts             # lớp gọi REST API
│  │  └─ types.ts
│  └─ vite.config.ts        # proxy /api -> http://localhost:4000
├─ server/                  # Express 5 + Drizzle ORM + pg
│  ├─ src/
│  │  ├─ routes/            # health.ts, mails.ts
│  │  ├─ middleware/        # error-handler.ts (HttpError, ZodError)
│  │  ├─ schema.ts          # định nghĩa bảng bằng Drizzle
│  │  ├─ db.ts              # pool + drizzle client
│  │  ├─ migrate.ts         # runner cho file .sql
│  │  └─ seed.ts            # dữ liệu mẫu
│  ├─ migrations/           # 0001_init.sql
│  └─ .env.example
├─ docker-compose.yml       # PostgreSQL 16 (host port 5433)
└─ package.json             # npm workspaces + script tổng
```

## Yêu cầu

- **Node.js >= 22** (server chạy TypeScript trực tiếp bằng type-stripping của Node, không cần `ts-node`/`tsx`)
- **Docker Desktop** (hoặc một PostgreSQL >= 13 đang chạy sẵn)

## Chạy dự án

```bash
# 1. Cài dependencies cho cả hai workspace
npm install

# 2. Tạo file cấu hình môi trường cho server
copy server\.env.example server\.env      # Windows
# cp server/.env.example server/.env      # macOS / Linux

# 3. Khởi động PostgreSQL (map ra cổng 5433 để không đụng PostgreSQL local ở 5432)
npm run db:up

# 4. Tạo bảng + dữ liệu mẫu
npm run db:migrate
npm run db:seed

# 5. Chạy song song API (4000) và web (5173)
npm run dev
```

- Web: <http://localhost:5173>
- API: <http://localhost:4000/api/health>

![Giao diện Mail Service](docs/preview.png)

> Nếu cổng 5433 đã bị chiếm, đổi `POSTGRES_PORT` trong `docker-compose.yml` **và** `DATABASE_URL` trong `server/.env` cho khớp nhau.
>
> Muốn dùng PostgreSQL cài sẵn trên máy thay vì Docker: tạo database `mail_service` rồi sửa `DATABASE_URL` trong `server/.env` (ví dụ `postgresql://postgres:matkhau@localhost:5432/mail_service`).

## Script

| Lệnh | Mô tả |
| --- | --- |
| `npm run dev` | Chạy đồng thời API + web (concurrently) |
| `npm run dev:server` / `npm run dev:client` | Chạy riêng từng phần |
| `npm run build` | Build server (`tsc`) rồi build client (`vite build`) |
| `npm start` | Chạy API đã build ở `server/dist` (tự phục vụ luôn `client/dist`) |
| `npm run typecheck` | Kiểm tra kiểu cho cả hai phần |
| `npm run db:up` / `db:down` | Bật/tắt container PostgreSQL |
| `npm run db:migrate` | Áp các file `.sql` trong `server/migrations` |
| `npm run db:seed` | Xoá dữ liệu và nạp 3 mail mẫu |

## API

Base URL: `http://localhost:4000/api`

| Method | Endpoint | Mô tả |
| --- | --- | --- |
| GET | `/health` | Trạng thái API + kết nối DB |
| GET | `/mails?status=&search=&limit=&offset=` | Danh sách mail (phân trang, lọc, tìm kiếm) |
| GET | `/mails/:id` | Chi tiết một mail |
| POST | `/mails` | Tạo mail mới (`to`, `subject`, `body`) |
| POST | `/mails/:id/send` | Gửi mail (hiện là placeholder: đánh dấu `SENT`) |
| PATCH | `/mails/:id` | Cập nhật `status` / `error` |
| DELETE | `/mails/:id` | Xoá mail |

Trạng thái mail: `QUEUED` → `SENT` | `FAILED`.

Ví dụ:

```bash
curl -X POST http://localhost:4000/api/mails \
  -H "Content-Type: application/json" \
  -d '{"to":"khach@example.com","subject":"Xin chào","body":"Nội dung"}'
```

### Ghi chú thiết kế

- **Drizzle ORM + `pg`** (thuần JavaScript) thay vì ORM cần binary engine, để chạy được ở mọi môi trường kể cả sandbox hạn chế spawn tiến trình.
- **Migration là SQL thuần** trong `server/migrations`, được `src/migrate.ts` áp tuần tự và ghi lại vào bảng `_migrations`. Khi sửa `src/schema.ts`, hãy thêm một file `.sql` mới (không sửa file cũ).
- **`/mails/:id/send`** hiện chỉ đổi trạng thái — chỗ để cắm Nodemailer/SES/SendGrid sau này.
- **TypeScript chạy trực tiếp trên Node**: import nội bộ dùng đuôi `.ts`; `tsc` sẽ tự đổi thành `.js` khi build (`rewriteRelativeImportExtensions`).
- Khi chạy `npm run build` xong, server tự phục vụ `client/dist` (SPA fallback) nên có thể deploy chỉ với một process Node.

## Lưu ý khi chạy trong sandbox của agent (DSH)

Sandbox `workspace-write` chặn việc spawn tiến trình con có pipe, nên trong phiên agent:

- `vite` (dev/build) và `node --watch` sẽ lỗi `spawn EPERM` → cần chạy ở terminal thường, hoặc cấp quyền `danger-full-access`.
- Chạy server không watch thì vẫn được: `node src/index.ts` (trong `server/`).
- Không tạo được file `.env` tự động (bị chặn vì là file nhạy cảm) → phải tự copy từ `.env.example`.
