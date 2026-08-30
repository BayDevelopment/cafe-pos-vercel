// server/api/transactions/[id].delete.ts
import { defineEventHandler, getRouterParam, createError } from "h3";
import { db } from "../../utils/db";
import { requireOwner } from "../../utils/auth";

const STOCK_RETURNED_STATUSES = ["CANCELLED", "REFUNDED"];

export default defineEventHandler(async (event) => {
  await requireOwner(event);

  const idParam = getRouterParam(event, "id");
  const orderId = Number(idParam);

  if (!orderId || isNaN(orderId)) {
    throw createError({
      statusCode: 400,
      statusMessage: "ID Transaksi tidak valid",
    });
  }

  try {
    const existingOrder = await db.order.findUnique({
      where: { id: orderId },
      include: { orderItems: true },
    });

    if (!existingOrder) {
      throw createError({
        statusCode: 404,
        statusMessage: `Transaksi #${String(orderId).padStart(6, "0")} tidak ditemukan`,
      });
    }

    // Kembalikan stok HANYA jika order ini belum pernah "dikembalikan" stoknya
    // sebelumnya (yaitu bukan CANCELLED/REFUNDED) — supaya tidak dikembalikan dua kali.
    const stockAlreadyReturned = STOCK_RETURNED_STATUSES.includes(existingOrder.status);

    await db.$transaction(async (tx) => {
      if (!stockAlreadyReturned) {
        for (const item of existingOrder.orderItems) {
          await tx.product.update({
            where: { id: item.productId },
            data: { stock: { increment: item.quantity } },
          });
        }
      }

      await tx.order.delete({
        where: { id: orderId },
      });
    });

    return {
      success: true,
      message: stockAlreadyReturned
        ? `Transaksi #${String(orderId).padStart(6, "0")} berhasil dihapus.`
        : `Transaksi #${String(orderId).padStart(6, "0")} berhasil dihapus dan stok telah dikembalikan.`,
    };
  } catch (error: any) {
    if (error?.statusCode) throw error;

    console.error("Gagal menghapus transaksi:", error);
    throw createError({
      statusCode: 500,
      statusMessage: "Gagal menghapus transaksi. Silakan coba lagi.",
    });
  }
});