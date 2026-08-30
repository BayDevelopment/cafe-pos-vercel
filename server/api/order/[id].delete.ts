// server/api/order/[id].delete.ts
import { defineEventHandler, getRouterParam, createError } from "h3";
import { db } from "../../utils/db";
import { requireOwner } from "../../utils/auth";
import { OrderStatus } from "../../../generated/prisma/client";

const STOCK_RETURNED_STATUSES: OrderStatus[] = [OrderStatus.CANCELLED, OrderStatus.REFUNDED];

export default defineEventHandler(async (event) => {
  // Hanya Pemilik yang boleh membatalkan/menghapus order.
  await requireOwner(event);

  const idParam = getRouterParam(event, "id");
  const orderId = Number(idParam);
  if (!idParam || !Number.isInteger(orderId) || orderId <= 0) {
    throw createError({ statusCode: 400, statusMessage: "ID pesanan tidak valid" });
  }

  try {
    const existingOrder = await db.order.findUnique({
      where: { id: orderId },
      include: { orderItems: true },
    });

    if (!existingOrder) {
      throw createError({ statusCode: 404, statusMessage: "Pesanan yang akan dihapus tidak ditemukan" });
    }

    if (STOCK_RETURNED_STATUSES.includes(existingOrder.status)) {
      throw createError({
        statusCode: 400,
        statusMessage: `Pesanan ini sudah ${existingOrder.status === OrderStatus.CANCELLED ? "dibatalkan" : "di-refund"} sebelumnya.`,
      });
    }

    // Soft-delete: ubah status jadi CANCELLED (bukan hapus baris permanen) supaya
    // riwayat transaksi tetap ada untuk audit/laporan keuangan, dan kembalikan stok
    // produk yang sempat terpotong saat order dibuat.
    await db.$transaction(async (tx) => {
      for (const item of existingOrder.orderItems) {
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { increment: item.quantity } },
        });
      }

      await tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.CANCELLED },
      });
    });

    return {
      success: true,
      message: `Pesanan #${orderId} berhasil dibatalkan dan stok telah dikembalikan.`,
    };
  } catch (error: any) {
    if (error?.statusCode) throw error;

    console.error("Gagal menghapus pesanan:", error);
    throw createError({ statusCode: 500, statusMessage: "Terjadi kesalahan server." });
  }
});