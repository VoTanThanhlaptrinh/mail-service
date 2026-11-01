import { closeDb, db } from './db.ts';
import { mails } from './schema.ts';

const samples = [
  {
    to: 'an.nguyen@example.com',
    subject: 'Chào mừng đến với Mail Service',
    body: 'Đây là email mẫu đầu tiên được tạo bởi script seed.',
    status: 'SENT' as const,
    sentAt: new Date(),
  },
  {
    to: 'binh.tran@example.com',
    subject: 'Báo cáo tuần 45',
    body: 'Báo cáo tiến độ tuần 45 đã sẵn sàng để gửi tới khách hàng.',
    status: 'QUEUED' as const,
  },
  {
    to: 'invalid@example.com',
    subject: 'Thông báo lỗi gửi thư',
    body: 'Email này mô phỏng một lần gửi thất bại.',
    status: 'FAILED' as const,
    error: 'SMTP 550: mailbox unavailable',
  },
];

async function main(): Promise<void> {
  await db.delete(mails);
  const inserted = await db.insert(mails).values(samples).returning({ id: mails.id });
  console.log(`Seeded ${inserted.length} mails.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
