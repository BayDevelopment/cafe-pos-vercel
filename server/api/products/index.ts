// server/api/products/index.ts
import {
  defineEventHandler,
  getMethod,
  getQuery,
  readMultipartFormData,
  createError,
} from "h3";
import { put, del } from "@vercel/blob";
import crypto from "node:crypto";
import { Prisma } from "../../../generated/prisma/client";
import { db } from "../../utils/db";
import { requireUser, requireOwner } from "../../utils/auth";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 10;
const MAX_IMAGE_SIZE = 1 * 1024 * 1024; // 1 MB
const MAX_NAME_LEN = 200;
const MAX_SKU_LEN = 50;

// Pengecekan Magic Byte Asli (PNG, JPEG, WebP)
function getMimeTypeFromBuffer(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;
  const hex = buffer.toString("hex", 0, 12).toUpperCase();
  if (hex.startsWith("89504E47")) return "image/png";
  if (hex.startsWith("FFD8FF")) return "image/jpeg";
  if (hex.startsWith("52494646") && hex.substring(16, 24) === "57454250")
    return "image/webp";
  return null;
}

export default defineEventHandler(async (event) => {
  const method = getMethod(event);

  // ==========================================
  // 1. GET Products (Kasir & Pemilik)
  // ==========================================
  if (method === "GET") {
    await requireUser(event);

    try {
      const query = getQuery(event);
      const page = Math.max(1, Number(query.page) || 1);
      const limit = Math.min(
        MAX_LIMIT,
        Math.max(1, Number(query.limit) || DEFAULT_LIMIT),
      );
      const skip = (page - 1) * limit;

      const search = query.search
        ? String(query.search).trim().slice(0, 100)
        : "";
      const rawCategoryId = query.category ? Number(query.category) : null;
      const categoryId =
        rawCategoryId && Number.isInteger(rawCategoryId) && rawCategoryId > 0
          ? rawCategoryId
          : null;

      let isActive: boolean | undefined;
      if (query.status === "true") isActive = true;
      if (query.status === "false") isActive = false;

      const onlyAvailable = query.available === "true";

      const where: Prisma.ProductWhereInput = {};
      if (search) {
        where.OR = [
          { name: { contains: search, mode: "insensitive" } },
          { sku: { contains: search, mode: "insensitive" } },
        ];
      }
      if (categoryId) where.categoryId = categoryId;
      if (isActive !== undefined) where.isActive = isActive;

      if (onlyAvailable) {
        where.stock = { gt: 0 };
        where.isActive = true;
      }

      const [products, totalItems] = await Promise.all([
        db.product.findMany({
          where,
          include: { category: true },
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
        }),
        db.product.count({ where }),
      ]);

      // Konversi Prisma Decimal ke Number agar aman di Frontend
      const sanitizedProducts = products.map((p) => ({
        ...p,
        price: Number(p.price),
        discount: Number(p.discount || 0),
        costPrice: p.costPrice ? Number(p.costPrice) : null,
      }));

      return {
        success: true,
        data: sanitizedProducts,
        pagination: {
          currentPage: page,
          perPage: limit,
          totalItems,
          totalPages: Math.ceil(totalItems / limit) || 1,
        },
      };
    } catch (error: any) {
      if (error?.statusCode) throw error;
      console.error("Gagal mengambil data produk:", error);
      throw createError({
        statusCode: 500,
        message: "Gagal mengambil data produk.",
      });
    }
  }

  // ==========================================
  // 2. POST Product — HANYA PEMILIK
  // ==========================================
  if (method === "POST") {
    await requireOwner(event);

    const files = await readMultipartFormData(event);
    if (!files) {
      throw createError({ statusCode: 400, message: "Invalid form data" });
    }

    let name = "";
    let sku = "";
    let priceRaw = "";
    let costPriceRaw = "";
    let discountRaw = "";
    let stockRaw = "";
    let categoryIdRaw = "";
    let isActive = true;
    let uploadedFile: { filename: string; data: Buffer } | null = null;

    for (const file of files) {
      const fieldName = file.name;
      const value = file.data.toString("utf-8");

      if (fieldName === "name") name = value.trim();
      if (fieldName === "sku") sku = value.trim();
      if (fieldName === "price") priceRaw = value.trim();
      if (fieldName === "costPrice") costPriceRaw = value.trim();
      if (fieldName === "discount") discountRaw = value.trim();
      if (fieldName === "stock") stockRaw = value.trim();
      if (fieldName === "categoryId") categoryIdRaw = value.trim();
      if (fieldName === "isActive") isActive = value === "true";

      if (fieldName === "image" && file.filename && file.data.length > 0) {
        uploadedFile = { filename: file.filename, data: file.data };
      }
    }

    if (!name) {
      throw createError({
        statusCode: 400,
        message: "Nama produk wajib diisi.",
      });
    }
    if (name.length > MAX_NAME_LEN) {
      throw createError({
        statusCode: 400,
        message: `Nama produk tidak boleh melebihi ${MAX_NAME_LEN} karakter.`,
      });
    }
    if (sku.length > MAX_SKU_LEN) {
      throw createError({
        statusCode: 400,
        message: `SKU tidak boleh melebihi ${MAX_SKU_LEN} karakter.`,
      });
    }

    const categoryId = Number(categoryIdRaw);
    if (!Number.isInteger(categoryId) || categoryId <= 0) {
      throw createError({
        statusCode: 400,
        message: "Kategori wajib dipilih.",
      });
    }

    const price = Number(priceRaw);
    if (!Number.isFinite(price) || price <= 0) {
      throw createError({
        statusCode: 400,
        message: "Harga jual wajib berupa angka lebih dari 0.",
      });
    }

    const costPrice = costPriceRaw ? Number(costPriceRaw) : 0;
    if (!Number.isFinite(costPrice) || costPrice < 0) {
      throw createError({
        statusCode: 400,
        message: "Harga modal harus berupa angka dan tidak boleh negatif.",
      });
    }

    const discount = discountRaw ? Number(discountRaw) : 0;
    if (!Number.isFinite(discount) || discount < 0) {
      throw createError({
        statusCode: 400,
        message: "Diskon produk harus berupa angka dan tidak boleh negatif.",
      });
    }
    if (discount > price) {
      throw createError({
        statusCode: 400,
        message: "Diskon tidak boleh melebihi harga jual produk.",
      });
    }

    const stock = stockRaw ? Number(stockRaw) : 0;
    if (!Number.isInteger(stock) || stock < 0) {
      throw createError({
        statusCode: 400,
        message: "Stok harus berupa bilangan bulat dan tidak boleh negatif.",
      });
    }

    const categoryExists = await db.category.findUnique({
      where: { id: categoryId },
      select: { id: true },
    });
    if (!categoryExists) {
      throw createError({
        statusCode: 400,
        message: "Kategori tidak ditemukan.",
      });
    }

    let imagePath: string | null = null;
    let savedBlobUrl: string | null = null;

    if (uploadedFile) {
      if (uploadedFile.data.length > MAX_IMAGE_SIZE) {
        throw createError({
          statusCode: 400,
          message: "Ukuran gambar terlalu besar. Maksimal 1 MB.",
        });
      }

      const detectedMime = getMimeTypeFromBuffer(uploadedFile.data);
      const allowedMimes = ["image/png", "image/jpeg", "image/webp"];
      if (!detectedMime || !allowedMimes.includes(detectedMime)) {
        throw createError({
          statusCode: 400,
          message:
            "File yang diunggah bukan gambar valid (Hanya PNG, JPG/JPEG, & WEBP yang diizinkan).",
        });
      }

      let safeExtension = ".jpg";
      if (detectedMime === "image/png") safeExtension = ".png";
      if (detectedMime === "image/webp") safeExtension = ".webp";

      const randomFileName = `product-${Date.now()}-${crypto.randomBytes(8).toString("hex")}${safeExtension}`;

      const blob = await put(randomFileName, uploadedFile.data, {
        access: "public",
        contentType: detectedMime,
        addRandomSuffix: false,
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });

      savedBlobUrl = blob.url;
      imagePath = blob.url;
    }

    const cleanupUploadedFile = async () => {
      if (savedBlobUrl) {
        await del(savedBlobUrl, {
          token: process.env.BLOB_READ_WRITE_TOKEN,
        }).catch(() => {});
      }
    };

    try {
      const newProduct = await db.product.create({
        data: {
          name,
          sku: sku || null,
          image: imagePath,
          price,
          costPrice: costPrice > 0 ? costPrice : null,
          discount,
          stock,
          categoryId,
          isActive,
        },
        include: { category: true },
      });

      return {
        success: true,
        message: "Produk berhasil ditambahkan",
        data: {
          ...newProduct,
          price: Number(newProduct.price),
          discount: Number(newProduct.discount),
          costPrice: newProduct.costPrice ? Number(newProduct.costPrice) : null,
        },
      };
    } catch (error: any) {
      await cleanupUploadedFile();

      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === "P2002") {
          throw createError({
            statusCode: 409,
            message: "Produk atau SKU ini sudah terdaftar di database.",
          });
        }
        if (error.code === "P2003") {
          throw createError({
            statusCode: 400,
            message: "Kategori tidak valid.",
          });
        }
      }

      console.error("Gagal menambah produk:", error);
      throw createError({
        statusCode: 500,
        message: "Gagal menambah produk. Silakan coba lagi.",
      });
    }
  }

  throw createError({ statusCode: 405, message: "Method not allowed" });
});
