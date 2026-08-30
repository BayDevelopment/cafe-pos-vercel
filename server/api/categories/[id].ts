// server/api/categories/[id].ts
import { defineEventHandler, getMethod, getRouterParam, readBody, createError } from "h3"
import { db } from "../../utils/db"
import { requireOwner } from "../../utils/auth"
import { Prisma } from "@prisma/client"

const validNamePattern = /^[a-zA-Z0-9\s&\-/()]+$/
const MAX_NAME_LEN = 100

export default defineEventHandler(async (event) => {
  const method = getMethod(event)
  const idParam = getRouterParam(event, "id")
  const categoryId = Number(idParam)

  if (!idParam || !Number.isInteger(categoryId) || categoryId <= 0) {
    throw createError({ statusCode: 400, statusMessage: "ID Kategori tidak valid." })
  }

  // Hanya PEMILIK yang boleh mengubah atau menghapus kategori.
  // requireOwner: verifikasi JWT + cek isActive + cross-check role ke DB (satu jalur terpusat).
  if (method === "PUT" || method === "DELETE") {
    await requireOwner(event)
  }

  // PUT: Update Kategori — HANYA PEMILIK
  if (method === "PUT") {
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
      const updatedCategory = await db.category.update({
        where: { id: categoryId },
        data: { name: trimmedName },
      })
      return { success: true, data: updatedCategory }
    } catch (error: any) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === "P2002") {
          throw createError({ statusCode: 409, statusMessage: "Kategori dengan nama tersebut sudah ada." })
        }
        if (error.code === "P2025") {
          throw createError({ statusCode: 404, statusMessage: "Kategori tidak ditemukan." })
        }
      }
      if (error?.statusCode) throw error

      console.error("Gagal memperbarui kategori:", error)
      throw createError({ statusCode: 500, statusMessage: "Gagal memperbarui kategori." })
    }
  }

  // DELETE: Hapus Kategori — HANYA PEMILIK
  if (method === "DELETE") {
    try {
      await db.category.delete({ where: { id: categoryId } })
      return { success: true, message: "Kategori berhasil dihapus" }
    } catch (error: any) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        // Kategori masih dipakai produk lain (onDelete: Restrict di schema)
        if (error.code === "P2003") {
          throw createError({
            statusCode: 400,
            statusMessage: "Kategori tidak dapat dihapus karena masih digunakan oleh beberapa produk.",
          })
        }
        if (error.code === "P2025") {
          throw createError({ statusCode: 404, statusMessage: "Kategori tidak ditemukan." })
        }
      }
      if (error?.statusCode) throw error

      console.error("Gagal menghapus kategori:", error)
      throw createError({ statusCode: 500, statusMessage: "Gagal menghapus kategori." })
    }
  }

  throw createError({ statusCode: 405, statusMessage: "Method not allowed" })
})