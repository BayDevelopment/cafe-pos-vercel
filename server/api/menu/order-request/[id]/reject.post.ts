import { defineEventHandler, getRouterParam, readBody, createError } from "h3";
import { db } from "../../../../utils/db";
import { requireUser } from "../../../../utils/auth";

export default defineEventHandler(async (event) => {
  // 1. Otorisasi Role (Hanya KASIR & PEMILIK)
  const authUser = await requireUser(event);
  const role = String(authUser.role).toUpperCase();

  if (role !== "KASIR" && role !== "PEMILIK") {
    throw createError({
      statusCode: 403,
      statusMessage: "Akses ditolak.",
    });
  }

  // 2. Validasi Parameter ID
  const id = Number(getRouterParam(event, "id"));
  if (!id || isNaN(id)) {
    throw createError({
      statusCode: 400,
      statusMessage: "ID pesanan tidak valid.",
    });
  }

  // 3. Cek Keberadaan Pesanan (sekalian ambil items untuk pengembalian stok)
  const existingOrder = await db.orderRequest.findUnique({
    where: { id },
    include: { items: true },
  });

  if (!existingOrder) {
    throw createError({
      statusCode: 404,
      statusMessage: "Pesanan tidak ditemukan.",
    });
  }

  // 4. Pastikan Status Masih PENDING
  if (existingOrder.status !== "PENDING") {
    throw createError({
      statusCode: 400,
      statusMessage: `Pesanan gagal ditolak karena status saat ini: ${existingOrder.status}.`,
    });
  }

  // 5. Baca Request Body secara Aman
  const body = await readBody(event).catch(() => ({}));
  const reason = body?.reason?.trim();

  // Format catatan: gabungkan alasan penolakan tanpa menimpa catatan asli pelanggan
  let updatedNote = existingOrder.note || "";
  if (reason) {
    updatedNote = updatedNote
      ? `${updatedNote} | [DITOLAK: ${reason}]`
      : `[DITOLAK: ${reason}]`;
  }

  // 6. Kembalikan stok yang sudah "dikunci" saat submit, lalu update status jadi REJECTED
  // Digabung dalam satu transaction supaya kalau salah satu produk gagal di-update,
  // status pesanan juga tidak ikut berubah (konsisten, tidak nyangkut setengah-setengah).
  try {
    const updated = await db.$transaction(async (tx) => {
      for (const item of existingOrder.items) {
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { increment: item.quantity } },
        });
      }

      return tx.orderRequest.update({
        where: { id },
        data: {
          status: "REJECTED",
          note: updatedNote || existingOrder.note,
        },
        include: {
          items: {
            include: { product: true },
          },
        },
      });
    });

    return {
      success: true,
      message: "Pesanan berhasil ditolak dan stok telah dikembalikan.",
      data: updated,
    };
  } catch (error: any) {
    if (error.statusCode) throw error;
    console.error("Gagal menolak pesanan:", error);
    throw createError({
      statusCode: 500,
      statusMessage: error.message || "Gagal menolak pesanan.",
    });
  }
});