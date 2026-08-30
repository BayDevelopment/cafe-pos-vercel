import 'dotenv/config'
import { PrismaClient } from '../../generated/prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient
}

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'error', 'warn']
        : ['error'],
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}

// --- GRACEFUL SHUTDOWN: tangani SIGTERM & SIGINT, bukan cuma beforeExit ---
let isShuttingDown = false
async function shutdown(signal: string) {
  if (isShuttingDown) return
  isShuttingDown = true
  console.log(`[prisma] Menerima ${signal}, menutup koneksi database...`)
  try {
    await prisma.$disconnect()
  } catch (err) {
    console.error('[prisma] Error saat shutdown:', err)
  } finally {
    process.exit(0)
  }
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('beforeExit', () => shutdown('beforeExit'))