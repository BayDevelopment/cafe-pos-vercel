// server/api/categories/index.ts
import { defineEventHandler, getMethod, getQuery, readBody, createError } from "h3"
import { db } from "../../utils/db"
import { requireUser, requireOwner } from "../../utils/auth"
import { Prisma } from "@prisma/client"

const validNamePattern = /^[a-zA-Z0-9\s&\-/()]+$/
const MAX_NAME_LEN = 100

export default defineEventHandler(async (event) => {
  const method = getMethod(event)

  // GET: Fetch Data Kategori dengan Search & Pagination (Kasir & Pemilik, wajib login)
  if (method === "GET") {
    await requireUser(event) // role apapun boleh, tapi wajib login

    try {
      const query = getQuery(event)
      const search = typeof query.search === "string" ? query.search.trim().slice(0, 100) : ""
      const page = Math.max(1, parseInt(query.page as string) || 1)
      const limit = Math.max(1, Math.min(100, parseInt(query.limit as string) || 10))
      const skip = (page - 1) * limit

      const whereCondition = search
        ? { name: { contains: search, mode: "insensitive" as const } }
        : {}

      const [total, categories] = await Promise.all([
        db.category.count({ where: whereCondition }),
        db.category.findMany({
          where: whereCondition,
          skip,
          take: limit,
          include: {
            _count: { select: { products: true } },
          },
          orderBy: { name: "asc" },
        }),
      ])

      return {
        success: true,
        data: categories,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit) || 1,
        },
      }
    } catch (error: any) {
      if (error?.statusCode) throw error
      console.error("Gagal mengambil data kategori:", error)
      throw createError({ statusCode: 500, statusMessage: "Gagal mengambil data kategori." })
    }
  }

  // POST: Tambah Kategori Baru — HANYA PEMILIK
  if (method === "POST") {
    await requireOwner(event)

    const body = await readBody(event)
    const trimmedName = typeof body?.name === "string" ? body.name.trim() : ""

    if (!trimmedName) {
      throw createError({ statusCode: 400, statusMessage: "Nama kategori wajib diisi." })
    }

    if (trimmedName.length > MAX_NAME_LEN) {
      throw createError({ statusCode: 400, statusMessage: `Nama kategori tidak boleh melebihi ${MAX_NAME_LEN} karakter.` })
    }

    if (!validNamePattern.test(trimmedName)) {
      throw createError({
        statusCode: 400,
        statusMessage: "Nama kategori hanya boleh berisi huruf, angka, spasi, dan simbol (&, -, /, ()).",
      })
    }

    try {
      const newCategory = await db.category.create({
        data: { name: trimmedName },
      })
      return { success: true, data: newCategory }
    } catch (error: any) {
      // Unique constraint violation (nama kategori sudah ada) — beri pesan yang jelas, bukan 500 generik.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw createError({ statusCode: 409, statusMessage: "Kategori dengan nama tersebut sudah ada." })
      }
      if (error?.statusCode) throw error

      console.error("Gagal menambah kategori:", error)
      throw createError({ statusCode: 500, statusMessage: "Gagal menambah kategori." })
    }
  }

  throw createError({ statusCode: 405, statusMessage: "Method not allowed" })
})