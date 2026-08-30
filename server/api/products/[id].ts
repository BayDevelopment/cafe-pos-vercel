// server/api/products/[id].ts
import {
  defineEventHandler,
  getMethod,
  getRouterParam,
  readMultipartFormData,
  createError,
} from "h3";
import { put, del } from "@vercel/blob";
import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "../../utils/db";
import { requireOwner } from "../../utils/auth";

const MAX_IMAGE_SIZE = 1 * 1024 * 1024; // 1 MB
const MAX_NAME_LEN = 200;
const MAX_SKU_LEN = 50;

function getMimeTypeFromBuffer(buffer: Buffer): string | null {
  if (buffer.length < 4) return null;
  const hex = buffer.toString("hex", 0, 4).toUpperCase();
  if (hex === "89504E47") return "image/png";
  if (hex.startsWith("FFD8FF")) return "image/jpeg";
  return null;
}

async function safeDeleteFile(imageUrl: string | null) {
  if (!imageUrl || typeof imageUrl !== "string") return;
  await del(imageUrl, { token: process.env.BLOB_READ_WRITE_TOKEN }).catch(
    () => {},
  );
}

export default defineEventHandler(async (event) => {
  const method = getMethod(event);
  const idRaw = getRouterParam(event, "id");

  const productId = Number(idRaw);
  if (!idRaw || !Number.isInteger(productId) || productId <= 0) {
    throw createError({ statusCode: 400, message: "ID produk tidak valid" });
  }

  // Hanya PEMILIK yang boleh mengubah atau menghapus produk.
  if (method === "PUT" || method === "DELETE") {
    await requireOwner(event);
  }

  // ==========================================
  // UPDATE PRODUK (PUT) — HANYA PEMILIK
  // ==========================================
  if (method === "PUT") {
    const files = await readMultipartFormData(event);
    if (!files) {
      throw createError({ statusCode: 400, message: "Invalid form data" });
    }

    const existingProduct = await db.product.findUnique({
      where: { id: productId },
    });
    if (!existingProduct) {
      throw createError({ statusCode: 404, message: "Produk tidak ditemukan" });
    }

    let name = existingProduct.name;
    let sku = existingProduct.sku;
    let price = Number(existingProduct.price);
    let costPrice = existingProduct.costPrice
      ? Number(existingProduct.costPrice)
      : null;
    let discount = Number(existingProduct.discount || 0);
    let stock = existingProduct.stock;
    let categoryId = existingProduct.categoryId;
    let isActive = existingProduct.isActive;
    let removeImage = false;
    let uploadedFile: { filename: string; data: Buffer } | null = null;

    for (const file of files) {
      const fieldName = file.name;
      const value = file.data.toString("utf-8").trim();

      if (fieldName === "name" && value) {
        if (value.length > MAX_NAME_LEN) {
          throw createError({
            statusCode: 400,
            message: `Nama produk tidak boleh melebihi ${MAX_NAME_LEN} karakter.`,
          });
        }
        name = value;
      }

      if (fieldName === "sku") {
        if (value.length > MAX_SKU_LEN) {
          throw createError({
            statusCode: 400,
            message: `SKU tidak boleh melebihi ${MAX_SKU_LEN} karakter.`,
          });
        }
        sku = value || null;
      }

      if (fieldName === "price" && value !== "") {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          throw createError({
            statusCode: 400,
            message: "Harga jual wajib berupa angka lebih dari 0.",
          });
        }
        price = parsed;
      }

      if (fieldName === "costPrice" && value !== "") {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed < 0) {
          throw createError({
            statusCode: 400,
            message: "Harga modal harus berupa angka dan tidak boleh negatif.",
          });
        }
        costPrice = parsed;
      }

      if (fieldName === "discount" && value !== "") {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed < 0) {
          throw createError({
            statusCode: 400,
            message:
              "Diskon produk harus berupa angka dan tidak boleh negatif.",
          });
        }
        discount = parsed;
      }

      if (fieldName === "stock" && value !== "") {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed < 0) {
          throw createError({
            statusCode: 400,
            message:
              "Stok harus berupa bilangan bulat dan tidak boleh negatif.",
          });
        }
        stock = parsed;
      }

      if (fieldName === "categoryId" && value !== "") {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          throw createError({
            statusCode: 400,
            message: "Kategori tidak valid.",
          });
        }
        categoryId = parsed;
      }

      if (fieldName === "isActive") isActive = value === "true";
      if (fieldName === "removePhoto" || fieldName === "removeImage")
        removeImage = value === "true";

      if (fieldName === "image" && file.filename && file.data.length > 0) {
        uploadedFile = { filename: file.filename, data: file.data };
      }
    }

    if (discount > price) {
      throw createError({
        statusCode: 400,
        message: "Diskon tidak boleh melebihi harga jual produk.",
      });
    }

    if (categoryId !== existingProduct.categoryId) {
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
    }

    let finalImagePath: string | null | undefined = undefined;
    let savedBlobUrl: string | null = null;

    if (uploadedFile) {
      if (uploadedFile.data.length > MAX_IMAGE_SIZE) {
        throw createError({
          statusCode: 400,
          message: "Ukuran gambar maksimal 1 MB",
        });
      }

      const detectedMime = getMimeTypeFromBuffer(uploadedFile.data);
      if (
        !detectedMime ||
        !["image/png", "image/jpeg"].includes(detectedMime)
      ) {
        throw createError({
          statusCode: 400,
          message:
            "Format gambar ditolak. Hanya PNG dan JPG/JPEG asli yang diizinkan.",
        });
      }

      const safeExtension = detectedMime === "image/png" ? ".png" : ".jpg";
      const randomFileName = `product-${Date.now()}-${crypto.randomBytes(8).toString("hex")}${safeExtension}`;

      const blob = await put(randomFileName, uploadedFile.data, {
        access: "public",
        contentType: detectedMime,
        addRandomSuffix: false,
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });

      savedBlobUrl = blob.url;
      finalImagePath = blob.url;
    } else if (removeImage) {
      finalImagePath = null;
    }

    try {
      const updatedProduct = await db.product.update({
        where: { id: productId },
        data: {
          name,
          sku,
          price,
          costPrice,
          discount,
          stock,
          categoryId,
          isActive,
          ...(finalImagePath !== undefined && { image: finalImagePath }),
        },
      });

      // Hapus file lama jika ada upload baru ATAU jika user sengaja menghapus gambar
      if (finalImagePath !== undefined && existingProduct.image) {
        await safeDeleteFile(existingProduct.image);
      }

      return {
        success: true,
        message: "Produk berhasil diperbarui",
        data: {
          ...updatedProduct,
          price: Number(updatedProduct.price),
          discount: Number(updatedProduct.discount),
          costPrice: updatedProduct.costPrice
            ? Number(updatedProduct.costPrice)
            : null,
        },
      };
    } catch (error: any) {
      if (savedBlobUrl) {
        await del(savedBlobUrl, {
          token: process.env.BLOB_READ_WRITE_TOKEN,
        }).catch(() => {});
      }

      const errorCode = String(error?.code || "");
      if (errorCode === "P2002") {
        throw createError({
          statusCode: 409,
          message: "SKU produk sudah digunakan.",
        });
      }
      if (errorCode === "P2003") {
        throw createError({
          statusCode: 400,
          message: "Kategori tidak valid.",
        });
      }

      console.error("Gagal memperbarui produk:", error);
      throw createError({
        statusCode: 500,
        message: "Gagal memperbarui produk.",
      });
    }
  }

  // ==========================================
  // DELETE PRODUK (DELETE) — HANYA PEMILIK
  // ==========================================
  if (method === "DELETE") {
    try {
      const existingProduct = await db.product.findUnique({
        where: { id: productId },
        select: {
          id: true,
          image: true,
          isActive: true,
          _count: {
            select: {
              orderItems: true,
            },
          },
        },
      });

      if (!existingProduct) {
        throw createError({
          statusCode: 404,
          message: "Produk tidak ditemukan.",
        });
      }

      const hasTransactionHistory =
        (existingProduct._count?.orderItems ?? 0) > 0;

      // 1. Jika terikat transaksi riil -> TIDAK BISA di-hard delete, ubah ke Non-Aktif (Soft Delete)
      if (hasTransactionHistory) {
        if (!existingProduct.isActive) {
          throw createError({
            statusCode: 400,
            message:
              "Produk tidak dapat dihapus permanen karena memiliki riwayat transaksi toko.",
          });
        }

        const softDeletedProduct = await db.product.update({
          where: { id: productId },
          data: { isActive: false },
        });

        return {
          success: true,
          message:
            "Produk memiliki riwayat transaksi. Status diubah menjadi Non-Aktif.",
          data: {
            ...softDeletedProduct,
            price: Number(softDeletedProduct.price),
            discount: Number(softDeletedProduct.discount),
            costPrice: softDeletedProduct.costPrice
              ? Number(softDeletedProduct.costPrice)
              : null,
          },
        };
      }

      // 2. Jika tidak ada transaksi -> Hard Delete permanen langsung
      const deletedProduct = await db.product.delete({
        where: { id: productId },
      });

      if (deletedProduct.image) {
        await safeDeleteFile(deletedProduct.image);
      }

      return {
        success: true,
        message: "Produk berhasil dihapus secara permanen.",
        data: deletedProduct,
      };
    } catch (error: any) {
      if (error.statusCode) throw error;

      console.error("Gagal menghapus produk:", error);
      throw createError({
        statusCode: 500,
        message: "Gagal menghapus produk.",
      });
    }
  }

  throw createError({ statusCode: 405, message: "Method not allowed" });
});
