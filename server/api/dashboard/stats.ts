// server/api/dashboard/stats.ts
import { defineEventHandler, createError } from "h3"
import { db } from "../../utils/db"
import { requireUser } from "../../utils/auth"
import { Role } from "@prisma/client"

export default defineEventHandler(async (event) => {
  // Wajib login (Kasir & Pemilik boleh akses) — dicek DI LUAR try/catch data,
  // supaya kalau gagal login, statusnya tetap 401, tidak ikut kebungkus jadi 500.
  const user = await requireUser(event)

  try {
    // 1. Statistik dasar (Kasir & Pemilik)
    const totalProduk = await db.product.count({ where: { isActive: true } })
    const totalKaryawan = await db.employee.count({ where: { status: "AKTIF" } })

    const startOfDay = new Date()
    startOfDay.setHours(0, 0, 0, 0)
    const endOfDay = new Date()
    endOfDay.setHours(23, 59, 59, 999)

    const totalPesananHariIni = await db.order.count({
      where: { createdAt: { gte: startOfDay, lte: endOfDay }, status: "PAID" },
    })

    const startOfYesterday = new Date(startOfDay)
    startOfYesterday.setDate(startOfYesterday.getDate() - 1)
    const endOfYesterday = new Date(endOfDay)
    endOfYesterday.setDate(endOfYesterday.getDate() - 1)

    const totalPesananKemarin = await db.order.count({
      where: { createdAt: { gte: startOfYesterday, lte: endOfYesterday }, status: "PAID" },
    })

    let pesananGrowth = 0
    if (totalPesananKemarin > 0) {
      pesananGrowth = Math.round(((totalPesananHariIni - totalPesananKemarin) / totalPesananKemarin) * 100)
    } else if (totalPesananHariIni > 0) {
      pesananGrowth = 100
    }

    // Grafik 7 hari terakhir — dijalankan paralel (Promise.all), bukan berurutan.
    const dayNames = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"]
    const dayRanges = Array.from({ length: 7 }, (_, idx) => {
      const i = 6 - idx
      const dStart = new Date()
      dStart.setDate(dStart.getDate() - i)
      dStart.setHours(0, 0, 0, 0)
      const dEnd = new Date(dStart)
      dEnd.setHours(23, 59, 59, 999)
      return { dStart, dEnd }
    })

    const weeklyCounts = await Promise.all(
      dayRanges.map(({ dStart, dEnd }) =>
        db.order.count({
          where: { createdAt: { gte: dStart, lte: dEnd }, status: "PAID" },
        })
      )
    )

    const weeklyData = dayRanges.map(({ dStart }, idx) => ({
      day: dayNames[dStart.getDay()],
      total: weeklyCounts[idx],
    }))

    const baseStats: Record<string, any> = {
      totalPesananHariIni,
      pesananGrowth,
      totalProduk,
      totalKaryawan,
      weeklyData,
    }

    // 2. KHUSUS PEMILIK: data finansial & stok kritis
    if (user.role === Role.PEMILIK) {
      const aggregateOmzet = await db.order.aggregate({
        where: { createdAt: { gte: startOfDay, lte: endOfDay }, status: "PAID" },
        _sum: { totalAmount: true },
      })

      const stokKritis = await db.product.count({
        where: { stock: { lte: 5 }, isActive: true },
      })

      baseStats.totalOmzet = Number(aggregateOmzet._sum.totalAmount || 0)
      baseStats.stokKritis = stokKritis
      baseStats.totalTransaksi = totalPesananHariIni
    }

    return baseStats
  } catch (error: any) {
    if (error?.statusCode) throw error

    console.error("Gagal mengambil data statistik dashboard:", error)
    throw createError({ statusCode: 500, message: "Gagal mengambil data statistik dashboard." })
  }
})