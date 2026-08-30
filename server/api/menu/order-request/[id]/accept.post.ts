import { defineEventHandler, getRouterParam, createError } from "h3";
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

  // 2. Validasi ID Param
  const id = Number(getRouterParam(event, "id"));
  if (!id || isNaN(id)) {
    throw createError({
      statusCode: 400,
      statusMessage: "ID pesanan tidak valid.",
    });
  }

  // 3. Ambil data Order Request beserta Produknya
  const orderRequest = await db.orderRequest.findUnique({
    where: { id },
    include: {
      items: {
        include: { product: true },
      },
    },
  });

  if (!orderRequest) {
    throw createError({
      statusCode: 404,
      statusMessage: "Pesanan tidak ditemukan.",
    });
  }

  // 4. Pastikan status pesanan masih PENDING
  if (orderRequest.status !== "PENDING") {
    throw createError({
      statusCode: 400,
      statusMessage: `Pesanan gagal diproses karena status saat ini: ${orderRequest.status}.`,
    });
  }

  // 5. Buat Order & update status OrderRequest
  // CATATAN: Stok TIDAK dipotong lagi di sini — sudah dipotong & "dikunci"
  // sejak pelanggan submit pesanan di order-request/index.post.ts (Opsi A).
  // Accept di sini murni administratif: konversi OrderRequest -> Order resmi.
  try {
    const result = await db.$transaction(async (tx) => {
      let totalDiscount = 0;
      let totalAmount = 0;

      const orderItemsData = orderRequest.items.map((item) => {
        const originalPrice = Number(item.price || item.product?.price || 0);
        const productDiscount = Number(item.product?.discount || 0);
        const finalPrice = Math.max(0, originalPrice - productDiscount);

        totalDiscount += productDiscount * item.quantity;
        totalAmount += finalPrice * item.quantity;

        return {
          productId: item.productId,
          quantity: item.quantity,
          price: finalPrice,
        };
      });

      const newOrder = await tx.order.create({
        data: {
          cashierId: String(authUser.id),
          customerName: orderRequest.customerName || "Pelanggan (Tamu)",
          totalAmount,
          discount: totalDiscount,
          note: orderRequest.note || null,
          orderItems: {
            create: orderItemsData,
          },
        },
        include: {
          orderItems: true,
        },
      });

      const updatedRequest = await tx.orderRequest.update({
        where: { id },
        data: { status: "ACCEPTED" },
        include: {
          items: {
            include: { product: true },
          },
        },
      });

      return {
        orderRequest: updatedRequest,
        order: newOrder,
      };
    });

    return {
      success: true,
      message: "Pesanan berhasil diterima dan dimasukkan ke tabel Order.",
      data: result,
    };
  } catch (error: any) {
    if (error.statusCode) throw error;
    console.error("Gagal menerima pesanan:", error);
    throw createError({
      statusCode: 500,
      statusMessage: error.message || "Gagal memproses penerimaan pesanan.",
    });
  }
});