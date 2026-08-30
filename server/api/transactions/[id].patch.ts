import { defineEventHandler, readBody, getRouterParam, createError } from "h3";
import { db } from "../../utils/db";
import { requireUser } from "../../utils/auth";

function todayWibDateString(): string {
    const now = new Date();
    const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    return wib.toISOString().split("T")[0];
}
function wibDayStartUtc(dateStr: string): Date {
    return new Date(`${dateStr}T00:00:00.000+07:00`);
}
function wibDayEndUtc(dateStr: string): Date {
    return new Date(`${dateStr}T23:59:59.999+07:00`);
}

const ALLOWED_STATUS = ["PENDING", "PAID", "CANCELLED", "REFUNDED"];
const ALLOWED_PAYMENT = ["CASH", "QRIS", "DEBIT", "KREDIT", "TRANSFER"];
// Status yang berarti "stok sudah dikembalikan ke inventory / pesanan tidak jadi"
const STOCK_RETURNED_STATUSES = ["CANCELLED", "REFUNDED"];

export default defineEventHandler(async (event) => {
    const authUser = await requireUser(event);
    const isOwner = String(authUser.role).toUpperCase() === "PEMILIK";

    const id = Number(getRouterParam(event, "id"));
    if (!Number.isInteger(id) || id <= 0) {
        throw createError({ statusCode: 400, statusMessage: "ID transaksi tidak valid." });
    }

    const order = await db.order.findUnique({
        where: { id },
        include: { orderItems: true },
    });
    if (!order) {
        throw createError({ statusCode: 404, statusMessage: "Transaksi tidak ditemukan." });
    }

    // --- Batasan khusus KASIR: hanya transaksi miliknya sendiri & hari ini ---
    if (!isOwner) {
        if (order.cashierId !== authUser.id) {
            throw createError({
                statusCode: 403,
                statusMessage: "Anda hanya dapat mengedit transaksi Anda sendiri.",
            });
        }

        const today = todayWibDateString();
        const start = wibDayStartUtc(today);
        const end = wibDayEndUtc(today);
        if (order.createdAt < start || order.createdAt > end) {
            throw createError({
                statusCode: 403,
                statusMessage: "Transaksi ini sudah lewat dari hari ini. Hubungi Pemilik untuk mengedit.",
            });
        }
    }

    const body = await readBody(event);
    const updateData: Record<string, any> = {};

    // --- Field yang boleh diedit KASIR maupun PEMILIK ---
    let newStatus: string | undefined;
    if (body.status !== undefined) {
        newStatus = String(body.status).toUpperCase();
        if (!ALLOWED_STATUS.includes(newStatus)) {
            throw createError({ statusCode: 400, statusMessage: "Status tidak valid." });
        }
        updateData.status = newStatus;
    }

    if (body.customerName !== undefined) {
        const name = String(body.customerName).trim().slice(0, 100);
        updateData.customerName = name || null;
    }

    if (body.note !== undefined) {
        const note = String(body.note).trim().slice(0, 300);
        updateData.note = note || null;
    }

    if (body.paymentMethod !== undefined) {
        const method = String(body.paymentMethod).toUpperCase();
        if (!ALLOWED_PAYMENT.includes(method)) {
            throw createError({ statusCode: 400, statusMessage: "Metode pembayaran tidak valid." });
        }
        updateData.paymentMethod = method;
    }

    // --- Field yang HANYA boleh diedit PEMILIK ---
    if (isOwner) {
        if (body.discount !== undefined) {
            const discount = Number(body.discount);
            if (!Number.isFinite(discount) || discount < 0) {
                throw createError({ statusCode: 400, statusMessage: "Diskon tidak valid." });
            }

            const items = await db.orderItem.findMany({ where: { orderId: id } });
            const subtotal = items.reduce((sum, i) => sum + Number(i.price) * i.quantity, 0);

            updateData.discount = discount;
            updateData.totalAmount = Math.max(0, subtotal - discount);
        }
    } else {
        const forbiddenFields = ["discount", "totalAmount", "orderItems", "cashierId"];
        const attempted = forbiddenFields.filter((f) => body[f] !== undefined);
        if (attempted.length > 0) {
            throw createError({
                statusCode: 403,
                statusMessage: `Anda tidak memiliki izin mengubah: ${attempted.join(", ")}.`,
            });
        }
    }

    if (Object.keys(updateData).length === 0) {
        throw createError({ statusCode: 400, statusMessage: "Tidak ada perubahan yang dikirim." });
    }

    // --- Tentukan apakah perlu penyesuaian stok akibat perubahan status ---
    const oldWasReturned = STOCK_RETURNED_STATUSES.includes(order.status);
    const newIsReturned = newStatus ? STOCK_RETURNED_STATUSES.includes(newStatus) : oldWasReturned;

    // true  = stok perlu DIKEMBALIKAN (baru saja jadi CANCELLED/REFUNDED, sebelumnya bukan)
    // false = stok perlu DIPOTONG LAGI (sebelumnya CANCELLED/REFUNDED, sekarang diaktifkan lagi)
    // null  = tidak ada perubahan status yang mempengaruhi stok
    let stockAdjustment: "return" | "deduct" | null = null;
    if (newStatus && newIsReturned !== oldWasReturned) {
        stockAdjustment = newIsReturned ? "return" : "deduct";
    }

    try {
        const updated = await db.$transaction(async (tx) => {
            if (stockAdjustment === "return") {
                for (const item of order.orderItems) {
                    await tx.product.update({
                        where: { id: item.productId },
                        data: { stock: { increment: item.quantity } },
                    });
                }
            } else if (stockAdjustment === "deduct") {
                for (const item of order.orderItems) {
                    const result = await tx.product.updateMany({
                        where: { id: item.productId, stock: { gte: item.quantity } },
                        data: { stock: { decrement: item.quantity } },
                    });
                    if (result.count === 0) {
                        throw createError({
                            statusCode: 409,
                            statusMessage: "Stok tidak mencukupi untuk mengaktifkan kembali transaksi ini.",
                        });
                    }
                }
            }

            return tx.order.update({
                where: { id },
                data: updateData,
                include: {
                    cashier: { select: { id: true, name: true, role: true } },
                    orderItems: { include: { product: true } },
                },
            });
        });

        return {
            success: true,
            message: "Transaksi berhasil diperbarui.",
            data: {
                id: updated.id,
                invoiceNo: String(updated.id).padStart(6, "0"),
                customerName: updated.customerName,
                cashierName: updated.cashier?.name || "Kasir",
                cashier: updated.cashier,
                status: updated.status,
                paymentMethod: updated.paymentMethod,
                totalAmount: Number(updated.totalAmount),
                discount: Number(updated.discount || 0),
                note: updated.note,
                createdAt: updated.createdAt,
                items: updated.orderItems.map((item) => ({
                    id: item.id,
                    productName: item.product?.name || "Produk",
                    quantity: item.quantity,
                    price: Number(item.price),
                })),
            },
        };
    } catch (error: any) {
        if (error?.statusCode) throw error;
        console.error("Gagal update transaksi:", error);
        throw createError({ statusCode: 500, statusMessage: "Gagal memperbarui transaksi." });
    }
});