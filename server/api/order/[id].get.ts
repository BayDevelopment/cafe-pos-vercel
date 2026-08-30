// server/api/order/[id].get.ts
import { defineEventHandler, getRouterParam, createError } from "h3";
import { db } from "../../utils/db";
import { requireUser } from "../../utils/auth";
import { Role } from "../../../generated/prisma/client";

// Cek apakah sebuah Date jatuh pada hari kalender yang sama dengan hari ini,
// dihitung berdasarkan WIB (UTC+7), supaya konsisten dengan scope "hari ini"
// yang dipakai di halaman riwayat kasir.
function isSameWibDay(date: Date, reference: Date = new Date()): boolean {
  const toWibDateString = (d: Date) => {
    const wib = new Date(d.getTime() + 7 * 60 * 60 * 1000);
    return wib.toISOString().split("T")[0];
  };
  return toWibDateString(date) === toWibDateString(reference);
}

export default defineEventHandler(async (event) => {
  const authUser = await requireUser(event);
  const isOwner = authUser.role === Role.PEMILIK;

  const idParam = getRouterParam(event, "id");
  const orderId = Number(idParam);
  if (!idParam || !Number.isInteger(orderId) || orderId <= 0) {
    throw createError({ statusCode: 400, statusMessage: "ID pesanan tidak valid" });
  }

  try {
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: {
        cashier: { select: { id: true, name: true, email: true, role: true } },
        orderItems: {
          include: { 
            // 👉 Tambahkan 'discount' agar riwayat detail produk menampilkan info diskon jika diperlukan
            product: { select: { id: true, name: true, price: true, discount: true } } 
          },
        },
      },
    });

    if (!order) {
      throw createError({ statusCode: 404, statusMessage: "Pesanan tidak ditemukan" });
    }

    // Owner: bebas akses semua order, kapan pun.
    // Kasir: boleh akses order APAPUN (bukan cuma miliknya sendiri) selama
    // masih dalam scope "hari ini" (WIB) — konsisten dengan apa yang mereka
    // lihat di halaman riwayat. Order dari hari sebelumnya tetap ditolak.
    const isWithinTodayScope = isSameWibDay(order.createdAt);

    if (!isOwner && !isWithinTodayScope) {
      throw createError({ statusCode: 403, statusMessage: "Anda tidak berhak melihat pesanan ini." });
    }

    // Mengatur respons data kasir untuk menjaga privasi email jika diakses sesama kasir
    const responseOrder = isOwner
      ? order
      : {
          ...order,
          cashier: order.cashier
            ? { id: order.cashier.id, name: order.cashier.name, role: order.cashier.role }
            : null,
        };

    return { success: true, data: responseOrder };
  } catch (error: any) {
    if (error?.statusCode) throw error;

    console.error("Gagal mengambil detail pesanan:", error);
    throw createError({ statusCode: 500, statusMessage: "Terjadi kesalahan server." });
  }
});