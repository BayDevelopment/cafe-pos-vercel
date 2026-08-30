// prisma/seed.ts
import "dotenv/config";
import { PrismaClient } from '../generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import bcrypt from 'bcrypt';

// 1. Buat pool koneksi pg
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
// 2. Buat adapter Prisma
const adapter = new PrismaPg(pool);
// 3. Masukkan adapter ke konstruktor PrismaClient
const prisma = new PrismaClient({ adapter });

async function main() {
  await prisma.passwordResetToken.deleteMany({});
  await prisma.verificationToken.deleteMany({});
  await prisma.user.deleteMany({});

  const hashedPassword = await bcrypt.hash('password123', 10);

  const owner = await prisma.user.create({
    data: {
      email: 'owner@kedaikopi.com',
      password: hashedPassword,
      name: 'Bayu Albar Ladici (Owner)',
      role: 'PEMILIK',
      isActive: true,
      emailVerifiedAt: new Date(),
    },
  });

  const kasir = await prisma.user.create({
    data: {
      email: 'kasir@kedaikopi.com',
      password: hashedPassword,
      name: 'Kasir Terminal 01',
      role: 'KASIR',
      isActive: true,
      emailVerifiedAt: new Date(),
    },
  });

  console.log('🌱 Seed berhasil dijalankan!');
  console.log({ owner, kasir });
}

main()
  .catch((e) => {
    console.error('❌ Gagal melakukan seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end(); // Tutup pool koneksi database
  });