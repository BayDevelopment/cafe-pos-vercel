// server/api/order/index.post.ts
import { defineEventHandler, getMethod, readBody, createError } from "h3";
import { db } from "../../utils/db";
import { requireUser } from "../../utils/auth";
import { PaymentMethod } from "../../../generated/prisma/client";
import { Prisma } from "../../../generated/prisma/client";

const MAX_ITEMS = 100;
const MAX_QTY_PER_ITEM = 9999;
const MAX_NOTE_LEN = 500;
const MAX_CUSTOMER_NAME_LEN = 100;

function parsePaymentMethod(value: unknown): PaymentMethod {
  const upper = String(value || "CASH").trim().toUpperCase();
  const valid = new Set(Object.values(PaymentMethod));
  if (!valid.has(upper as PaymentMethod)) {
    throw createError({ statusCode: 400, statusMessage: `Metode pembayaran tidak valid: ${upper}` });
  }
  return upper as PaymentMethod;
}

// Pembulatan ke 2 desimal, konsisten dengan kolom Decimal(10,2) di schema.
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export default defineEventHandler(async (event) => {
  if (getMethod(event) !== "POST") {
    throw createError({ statusCode: 405, statusMessage: "Method not allowed" });
  }

  const authUser = await requireUser(event);
  const cashierId = String(authUser.id);

  // --- Ekstrak & validasi body ---
  const body = await readBody(event).catch(() => ({}));
  const { items, paymentMethod, discount, note, customerName } = body || {};

  if (!items || !Array.isArray(items) || items.length === 0) {
    throw createError({ statusCode: 400, statusMessage: "Keranjang belanja tidak boleh kosong" });
  }
  if (items.length > MAX_ITEMS) {
    throw createError({ statusCode: 400, statusMessage: `Maksimal ${MAX_ITEMS} item per transaksi.` });
  }

  const validatedPaymentMethod = parsePaymentMethod(paymentMethod);

  const rawDiscount = Number(discount) || 0;
  if (rawDiscount < 0) {
    throw createError({ statusCode: 400, statusMessage: "Diskon tidak boleh negatif." });
  }

  const formattedCustomerName = customerName ? String(customerName).trim().slice(0, MAX_CUSTOMER_NAME_LEN) : null;
  const formattedNote = note ? String(note).trim().slice(0, MAX_NOTE_LEN) : null;

  const cleanItems: { productId: number; quantity: number }[] = [];
  for (const item of items) {
    const quantity = Number(item?.quantity ?? item?.qty);
    const productId = Number(item?.productId ?? item?.id);

    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > MAX_QTY_PER_ITEM) {
      throw createError({ statusCode: 400, statusMessage: "Kuantitas item tidak valid." });
    }
    if (!Number.isInteger(productId) || productId <= 0) {
      throw createError({ statusCode: 400, statusMessage: "ID produk tidak valid." });
    }
    cleanItems.push({ productId, quantity });
  }

  try {
    const result = await db.$transaction(async (tx) => {
      const productIds = [...new Set(cleanItems.map((i) => i.productId))];
      
      // 👉 Tambahkan 'discount' ke dalam select database
      const products = await tx.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, name: true, price: true, discount: true, isActive: true },
      });
      const productMap = new Map(products.map((p) => [p.id, p]));

      const orderItemsData: { productId: number; quantity: number; price: Prisma.Decimal }[] = [];
      let subtotal = 0;

      for (const { productId, quantity } of cleanItems) {
        const product = productMap.get(productId);
        if (!product) {
          throw createError({ statusCode: 404, statusMessage: `Produk dengan ID ${productId} tidak ditemukan` });
        }
        if (!product.isActive) {
          throw createError({ statusCode: 400, statusMessage: `Produk "${product.name}" sudah tidak aktif dijual.` });
        }

        const updated = await tx.product.updateMany({
          where: { id: productId, stock: { gte: quantity } },
          data: { stock: { decrement: quantity } },
        });

        if (updated.count === 0) {
          const current = await tx.product.findUnique({ where: { id: productId }, select: { stock: true } });
          throw createError({
            statusCode: 400,
            statusMessage: `Stok untuk "${product.name}" tidak mencukupi (Sisa stok: ${current?.stock ?? 0}, diminta: ${quantity})`,
          });
        }

        // 👉 Hitung harga efektif per item (Harga Jual dikurangi Diskon Produk)
        const basePrice = Number(product.price);
        const productDiscount = Number(product.discount || 0);
        const effectivePrice = Math.max(0, basePrice - productDiscount); // Mencegah harga minus

        // Simpan harga efektif ke orderItem
        orderItemsData.push({ 
          productId, 
          quantity, 
          price: new Prisma.Decimal(effectivePrice) 
        });

        subtotal += effectivePrice * quantity;
      }

      subtotal = round2(subtotal);

      // Diskon order/keranjang (Order.discount)
      const discountAmount = round2(Math.min(rawDiscount, subtotal));
      const totalAmount = round2(subtotal - discountAmount);

      const createdOrder = await tx.order.create({
        data: {
          customerName: formattedCustomerName,
          paymentMethod: validatedPaymentMethod,
          totalAmount,
          discount: discountAmount,
          note: formattedNote,
          cashier: { connect: { id: cashierId } },
          orderItems: { create: orderItemsData },
        },
        include: {
          cashier: { select: { id: true, name: true, role: true } },
          orderItems: { include: { product: true } },
        },
      });

      return createdOrder;
    });

    return {
      success: true,
      orderId: result.id,
      message: "Transaksi berhasil diproses",
      data: {
        id: result.id,
        invoiceNo: String(result.id).padStart(6, "0"),
        customerName: result.customerName || "Pelanggan Umum",
        cashierName: result.cashier?.name || "Kasir",
        cashier: result.cashier,
        totalAmount: Number(result.totalAmount),
        discount: Number(result.discount),
        paymentMethod: result.paymentMethod,
        createdAt: result.createdAt,
        items: result.orderItems.map((item) => ({
          id: item.id,
          productName: item.product?.name || "Produk",
          quantity: item.quantity,
          price: Number(item.price),
        })),
      },
    };
  } catch (error: any) {
    if (error?.statusCode) throw error;

    console.error("ORDER CREATION ERROR:", error);
    throw createError({ statusCode: 500, statusMessage: "Gagal memproses transaksi. Silakan coba lagi." });
  }
});