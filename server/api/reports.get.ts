// server/api/reports.get.ts
import { defineEventHandler, getMethod, getQuery, createError } from "h3";
import { db } from "../utils/db";
import { requireOwner } from "../utils/auth";
import { OrderStatus, PaymentMethod } from "@prisma/client";

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;
const MAX_SEARCH_LEN = 100;
const MAX_INT32 = 2147483647; // Batas maksimum ID PostgreSQL/MySQL INT4

// Helper Parsing Tanggal yang Aman
function parseDateParam(value: unknown, endOfDay: boolean): Date | undefined {
  if (!value) return undefined;
  const strVal = String(value).trim();
  if (!strVal) return undefined;

  // Hanya tempelkan suffix jika formatnya murni YYYY-MM-DD
  let dateStr = strVal;
  if (/^\d{4}-\d{2}-\d{2}$/.test(strVal)) {
    dateStr = `${strVal}${endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z"}`;
  }

  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    throw createError({ statusCode: 400, message: "Format tanggal tidak valid." });
  }
  return date;
}

// Helper Parsing Status yang Aman
function parseStatusParam(value: unknown): OrderStatus[] | undefined {
  if (!value) return undefined;
  const parts = String(value)
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  // Jika setelah di-filter tidak ada value, return undefined
  if (parts.length === 0) return undefined;

  const validStatuses = new Set(Object.values(OrderStatus));
  const invalid = parts.filter((p) => !validStatuses.has(p as OrderStatus));
  if (invalid.length > 0) {
    throw createError({ statusCode: 400, message: `Status tidak valid: ${invalid.join(", ")}` });
  }
  return parts as OrderStatus[];
}

// Helper Parsing Payment Method
function parsePaymentParam(value: unknown): PaymentMethod | undefined {
  if (!value) return undefined;
  const upper = String(value).trim().toUpperCase();
  if (!upper) return undefined;

  const validMethods = new Set(Object.values(PaymentMethod));
  if (!validMethods.has(upper as PaymentMethod)) {
    throw createError({ statusCode: 400, message: `Metode pembayaran tidak valid: ${upper}` });
  }
  return upper as PaymentMethod;
}

export default defineEventHandler(async (event) => {
  if (getMethod(event) !== "GET") {
    throw createError({ statusCode: 405, message: "Method Not Allowed" });
  }

  // Wajib login sebagai Pemilik
  await requireOwner(event);

  const query = getQuery(event);

  const startDate = parseDateParam(query.startDate, false);
  const endDate = parseDateParam(query.endDate, true);
  const statusFilter = parseStatusParam(query.status);
  const paymentFilter = parsePaymentParam(query.paymentMethod);

  const rawSearch = query.search ? String(query.search).trim() : "";
  const search = rawSearch.slice(0, MAX_SEARCH_LEN);

  // Flag khusus jika frontend meminta semua data untuk Export Excel
  const isExport = query.export === "true";

  const page = Math.max(Number(query.page) || 1, 1);
  const pageSize = isExport 
    ? 10000 
    : Math.min(Math.max(Number(query.pageSize) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);

  // --- Filter Tanggal & Tambahan ---
  const dateFilter = startDate || endDate ? {
    createdAt: {
      ...(startDate && { gte: startDate }),
      ...(endDate && { lte: endDate }),
    },
  } : {};

  const statusWhere = statusFilter ? { status: { in: statusFilter } } : {};
  const paymentWhere = paymentFilter ? { paymentMethod: paymentFilter } : {};

  let searchWhere = {};
  if (search) {
    const cleanSearch = search.replace(/^#?ORD-?/i, "");
    const idNumber = parseInt(cleanSearch, 10);
    
    // Mencegah Integer Overflow pada Database
    const isValidId = !isNaN(idNumber) && 
                      String(idNumber) === cleanSearch && 
                      idNumber > 0 && 
                      idNumber <= MAX_INT32;

    searchWhere = isValidId
      ? { id: idNumber }
      : { customerName: { contains: search, mode: "insensitive" as const } };
  }

  // Filter gabungan untuk tabel
  const whereClause = {
    AND: [dateFilter, statusWhere, paymentWhere, searchWhere].filter((c) => Object.keys(c).length > 0),
  };

  // Filter khusus Transaksi Lunas (PAID) untuk Metrik Utama
  const summaryWhereClause = {
    AND: [dateFilter, { status: OrderStatus.PAID }, paymentWhere, searchWhere].filter((c) => Object.keys(c).length > 0),
  };

  // Filter khusus Transaksi Batal/Refund
  const cancelledWhereClause = {
    AND: [
      dateFilter, 
      { status: { in: [OrderStatus.CANCELLED, OrderStatus.REFUNDED] } }, 
      paymentWhere, 
      searchWhere
    ].filter((c) => Object.keys(c).length > 0),
  };

  try {
    // Eksekusi semua query secara Paralel di Database
    const [
      orders,
      totalDataCount,
      paidAggregate,
      cancelledAggregate,
      itemsSoldAggregate,
      paymentGroupBy,
      topProductGroup
    ] = await Promise.all([
      // 1. Data list transaksi (Paginated / Full untuk Export)
      db.order.findMany({
        where: whereClause,
        include: {
          cashier: { select: { id: true, name: true } },
          orderItems: { include: { product: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: isExport ? 0 : (page - 1) * pageSize,
        take: pageSize,
      }),

      // 2. Count total data untuk pagination
      db.order.count({ where: whereClause }),

      // 3. Agregat Pendapatan & Total Transaksi Lunas
      db.order.aggregate({
        where: summaryWhereClause,
        _sum: { totalAmount: true },
        _count: true,
      }),

      // 4. Agregat Transaksi Batal / Refund
      db.order.aggregate({
        where: cancelledWhereClause,
        _sum: { totalAmount: true },
        _count: true,
      }),

      // 5. Total Item Produk Terjual (Kuantitas)
      db.orderItem.aggregate({
        where: { order: summaryWhereClause },
        _sum: { quantity: true },
      }),

      // 6. Breakdown Metode Pembayaran (Group By)
      db.order.groupBy({
        by: ['paymentMethod'],
        where: summaryWhereClause,
        _sum: { totalAmount: true },
      }),

      // 7. Top 5 Produk Terlaris (Group By Product ID)
      db.orderItem.groupBy({
        by: ['productId'],
        where: { order: summaryWhereClause },
        _sum: { quantity: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: 5,
      })
    ]);

    // --- Format Payment Breakdown ---
    const paymentBreakdownMap: Record<string, number> = {
      CASH: 0, QRIS: 0, DEBIT: 0, KREDIT: 0, TRANSFER: 0
    };
    paymentGroupBy.forEach(item => {
      if (item.paymentMethod) {
        paymentBreakdownMap[item.paymentMethod] = Number(item._sum.totalAmount || 0);
      }
    });

    // --- Format Top 5 Products ---
    const topProductIds = topProductGroup.map(g => g.productId).filter(Boolean) as number[];
    let topProductsFormatted: { name: string; quantity: number; revenue: number }[] = [];

    if (topProductIds.length > 0) {
      const [products, topOrderItems] = await Promise.all([
        db.product.findMany({
          where: { id: { in: topProductIds } },
          select: { id: true, name: true }
        }),
        db.orderItem.findMany({
          where: {
            productId: { in: topProductIds },
            order: summaryWhereClause
          },
          select: { productId: true, quantity: true, price: true }
        })
      ]);

      const productMap = new Map(products.map(p => [p.id, p.name]));
      const revenueMap = new Map<number, number>();

      topOrderItems.forEach(item => {
        if (item.productId) {
          const current = revenueMap.get(item.productId) || 0;
          revenueMap.set(item.productId, current + (item.quantity * Number(item.price)));
        }
      });

      topProductsFormatted = topProductGroup.map(group => {
        const pId = group.productId!;
        return {
          name: productMap.get(pId) || "Produk Tidak Diketahui",
          quantity: group._sum.quantity || 0,
          revenue: revenueMap.get(pId) || 0
        };
      });
    }

    const totalRevenue = Number(paidAggregate._sum?.totalAmount ?? 0);
    const totalOrders = paidAggregate._count ?? 0;

    return {
      success: true,
      summary: {
        totalRevenue,
        totalOrders,
        avgOrderValue: totalOrders > 0 ? totalRevenue / totalOrders : 0,
        totalItemsSold: itemsSoldAggregate._sum?.quantity ?? 0,
        cancelledOrders: cancelledAggregate._count ?? 0,
        cancelledAmount: Number(cancelledAggregate._sum?.totalAmount ?? 0),
      },
      paymentBreakdown: paymentBreakdownMap,
      topProducts: topProductsFormatted,
      pagination: {
        page,
        pageSize,
        total: totalDataCount,
        totalPages: Math.ceil(totalDataCount / pageSize) || 1,
      },
      data: orders,
    };
  } catch (error: any) {
    if (error?.statusCode) throw error;
    console.error("Gagal memuat laporan:", error);
    throw createError({ statusCode: 500, message: "Gagal memuat laporan. Silakan coba lagi." });
  }
});