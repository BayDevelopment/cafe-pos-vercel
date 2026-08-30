// server/api/karyawan/[id].ts
import {
  defineEventHandler,
  getMethod,
  getRouterParam,
  getQuery,
  readMultipartFormData,
  createError,
} from "h3";
import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { Prisma } from "../../../generated/prisma/client";
import { db } from "../../utils/db";
import { requireOwner } from "../../utils/auth";

const MAX_PHOTO_SIZE = 1 * 1024 * 1024; // 1 MB
const MAX_NAME_LEN = 200;
const MAX_PHONE_LEN = 20;
const MAX_ADDRESS_LEN = 300;
const MAX_POSITION_LEN = 100;

// ⚠️ SESUAIKAN dengan value enum EmployeeStatus di schema.prisma kamu
const EMPLOYEE_STATUSES = ["AKTIF", "NONAKTIF"] as const;
type EmployeeStatusValue = (typeof EMPLOYEE_STATUSES)[number];

function isValidEmployeeStatus(value: string): value is EmployeeStatusValue {
  return (EMPLOYEE_STATUSES as readonly string[]).includes(value);
}

function getMimeTypeFromBuffer(buffer: Buffer): string | null {
  if (buffer.length < 4) return null;
  const hex = buffer.toString("hex", 0, 4).toUpperCase();
  if (hex === "89504E47") return "image/png";
  if (hex.startsWith("FFD8FF")) return "image/jpeg";
  return null;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function sanitizeEmployee(employee: any) {
  const { user, ...rest } = employee;
  return {
    ...rest,
    // ⚠️ SESUAIKAN field User yang mau diekspos ke frontend
    name: user?.name ?? null,
    email: user?.email ?? null,
    role: user?.role ?? null,
  };
}

async function deletePhotoFile(photoUrl: string | null | undefined) {
  if (!photoUrl) return;
  await del(photoUrl, { token: process.env.BLOB_READ_WRITE_TOKEN }).catch(
    () => {
      // Abaikan jika file sudah tidak ada / gagal dihapus
    },
  );
}

async function ensurePhoneUnique(phone: string, excludeEmployeeId?: string) {
  const existing = await db.employee.findFirst({
    where: {
      phone,
      ...(excludeEmployeeId ? { id: { not: excludeEmployeeId } } : {}),
    },
    select: { id: true },
  });
  if (existing) {
    throw createError({
      statusCode: 409,
      message: "Nomor telepon sudah digunakan oleh karyawan lain.",
    });
  }
}

export default defineEventHandler(async (event) => {
  await requireOwner(event);

  const method = getMethod(event);
  const id = getRouterParam(event, "id");

  if (!id) {
    throw createError({
      statusCode: 400,
      message: "ID karyawan wajib disertakan.",
    });
  }

  const existingEmployee = await db.employee.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, email: true, role: true } },
    },
  });

  if (!existingEmployee) {
    throw createError({
      statusCode: 404,
      message: "Karyawan tidak ditemukan.",
    });
  }

  // 1. GET Detail Karyawan
  if (method === "GET") {
    return {
      success: true,
      data: sanitizeEmployee(existingEmployee),
    };
  }

  // 2. PUT / PATCH — Edit Karyawan
  if (method === "PUT" || method === "PATCH") {
    const files = await readMultipartFormData(event);
    if (!files) {
      throw createError({ statusCode: 400, message: "Invalid form data" });
    }

    let name: string | undefined;
    let email: string | undefined;
    let password: string | undefined;
    let phone: string | undefined;
    let address: string | undefined;
    let birthDateRaw: string | undefined;
    let position: string | undefined;
    let statusRaw: string | undefined;
    let removePhoto = false;
    let uploadedFile: { filename: string; data: Buffer } | null = null;

    for (const file of files) {
      const fieldName = file.name;
      const value = file.data.toString("utf-8");

      if (fieldName === "name") name = value.trim();
      if (fieldName === "email") email = value.trim().toLowerCase();
      if (fieldName === "password") password = value; // kosongkan di form kalau tidak mau ganti password
      if (fieldName === "phone") phone = value.trim();
      if (fieldName === "address") address = value.trim();
      if (fieldName === "birthDate") birthDateRaw = value.trim();
      if (fieldName === "position") position = value.trim();
      if (fieldName === "status") statusRaw = value.trim();
      if (fieldName === "removePhoto") removePhoto = value === "true";

      if (fieldName === "photo" && file.filename && file.data.length > 0) {
        uploadedFile = { filename: file.filename, data: file.data };
      }
    }

    // --- VALIDASI (hanya untuk field yang dikirim) ---
    if (name !== undefined) {
      if (!name) {
        throw createError({
          statusCode: 400,
          message: "Nama karyawan wajib diisi.",
        });
      }
      if (name.length > MAX_NAME_LEN) {
        throw createError({
          statusCode: 400,
          message: `Nama tidak boleh melebihi ${MAX_NAME_LEN} karakter.`,
        });
      }
    }

    if (email !== undefined && email !== "" && !isValidEmail(email)) {
      throw createError({ statusCode: 400, message: "Email tidak valid." });
    }

    if (password !== undefined && password !== "" && password.length < 6) {
      throw createError({
        statusCode: 400,
        message: "Password minimal 6 karakter.",
      });
    }

    if (phone !== undefined) {
      if (!phone) {
        throw createError({
          statusCode: 400,
          message: "Nomor telepon wajib diisi.",
        });
      }
      if (phone.length > MAX_PHONE_LEN) {
        throw createError({
          statusCode: 400,
          message: `Nomor telepon tidak boleh melebihi ${MAX_PHONE_LEN} karakter.`,
        });
      }
      await ensurePhoneUnique(phone, id);

      const shopSettings = await db.shopSettings.findUnique({
        where: { id: "GLOBAL_SETTINGS" },
        select: { phone: true },
      });
      if (shopSettings?.phone && shopSettings.phone === phone) {
        throw createError({
          statusCode: 409,
          message:
            "Nomor telepon ini sudah digunakan sebagai nomor telepon toko.",
        });
      }
    }

    if (address !== undefined && address.length > MAX_ADDRESS_LEN) {
      throw createError({
        statusCode: 400,
        message: `Alamat tidak boleh melebihi ${MAX_ADDRESS_LEN} karakter.`,
      });
    }

    if (position !== undefined && position.length > MAX_POSITION_LEN) {
      throw createError({
        statusCode: 400,
        message: `Jabatan tidak boleh melebihi ${MAX_POSITION_LEN} karakter.`,
      });
    }

    let status: EmployeeStatusValue | undefined;
    if (statusRaw !== undefined) {
      if (!isValidEmployeeStatus(statusRaw)) {
        throw createError({
          statusCode: 400,
          message: "Status karyawan tidak valid.",
        });
      }
      status = statusRaw;
    }

    let birthDate: Date | null | undefined;
    if (birthDateRaw !== undefined) {
      if (birthDateRaw === "") {
        birthDate = null;
      } else {
        const parsed = new Date(birthDateRaw);
        if (Number.isNaN(parsed.getTime())) {
          throw createError({
            statusCode: 400,
            message: "Format tanggal lahir tidak valid.",
          });
        }
        birthDate = parsed;
      }
    }

    let newPhotoPath: string | null | undefined;
    let savedBlobUrl: string | null = null;

    if (uploadedFile) {
      if (uploadedFile.data.length > MAX_PHOTO_SIZE) {
        throw createError({
          statusCode: 400,
          message: "Ukuran foto terlalu besar. Maksimal 1 MB.",
        });
      }

      const detectedMime = getMimeTypeFromBuffer(uploadedFile.data);
      const allowedMimes = ["image/png", "image/jpeg"];
      if (!detectedMime || !allowedMimes.includes(detectedMime)) {
        throw createError({
          statusCode: 400,
          message:
            "File yang diunggah bukan gambar valid (Hanya PNG & JPG/JPEG asli yang diizinkan).",
        });
      }

      const safeExtension = detectedMime === "image/png" ? ".png" : ".jpg";
      const randomFileName = `employee-${Date.now()}-${crypto.randomBytes(8).toString("hex")}${safeExtension}`;

      const blob = await put(randomFileName, uploadedFile.data, {
        access: "public",
        contentType: detectedMime,
        addRandomSuffix: false,
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });

      savedBlobUrl = blob.url;
      newPhotoPath = blob.url;
    } else if (removePhoto) {
      newPhotoPath = null;
    }

    const cleanupNewFile = async () => {
      if (savedBlobUrl) {
        await del(savedBlobUrl, {
          token: process.env.BLOB_READ_WRITE_TOKEN,
        }).catch(() => {});
      }
    };

    try {
      const updated = await db.$transaction(async (tx) => {
        // Update data User terkait, hanya jika ada perubahan
        const userUpdateData: Record<string, any> = {};
        if (name !== undefined) userUpdateData.name = name;
        if (email !== undefined && email !== "") userUpdateData.email = email;
        if (password) userUpdateData.password = await bcrypt.hash(password, 10);

        if (Object.keys(userUpdateData).length > 0) {
          await tx.user.update({
            where: { id: existingEmployee.userId },
            data: userUpdateData,
          });
        }

        const employeeUpdateData: Prisma.EmployeeUpdateInput = {};
        if (phone !== undefined) employeeUpdateData.phone = phone;
        if (address !== undefined) employeeUpdateData.address = address || null;
        if (position !== undefined)
          employeeUpdateData.position = position || null;
        if (status !== undefined) employeeUpdateData.status = status;
        if (birthDate !== undefined) employeeUpdateData.birthDate = birthDate;
        if (newPhotoPath !== undefined) employeeUpdateData.photo = newPhotoPath;

        const updatedEmployee = await tx.employee.update({
          where: { id },
          data: employeeUpdateData,
          include: {
            user: { select: { id: true, name: true, email: true, role: true } },
          },
        });

        return updatedEmployee;
      });

      // Hapus foto lama dari disk setelah transaksi sukses (jika diganti/dihapus)
      if (
        newPhotoPath !== undefined &&
        existingEmployee.photo &&
        existingEmployee.photo !== newPhotoPath
      ) {
        await deletePhotoFile(existingEmployee.photo);
      }

      return {
        success: true,
        message: "Data karyawan berhasil diperbarui",
        data: sanitizeEmployee(updated),
      };
    } catch (error: any) {
      await cleanupNewFile();

      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === "P2002") {
          const target = Array.isArray(error.meta?.target)
            ? error.meta?.target.join(", ")
            : String(error.meta?.target ?? "");
          const message = target.includes("phone")
            ? "Nomor telepon sudah digunakan oleh karyawan lain."
            : `Data sudah terdaftar (${target || "email"}).`;
          throw createError({ statusCode: 409, message });
        }
        if (error.code === "P2025") {
          throw createError({
            statusCode: 404,
            message: "Karyawan tidak ditemukan.",
          });
        }
      }

      console.error("Gagal memperbarui karyawan:", error);
      throw createError({
        statusCode: 500,
        message: "Gagal memperbarui data karyawan.",
      });
    }
  }

  // 3. DELETE — Hapus Karyawan
  // Default: hapus akun User terkait (otomatis cascade menghapus Employee, sesuai relasi di schema).
  // Tambahkan ?soft=true pada query jika ingin sekadar menonaktifkan (set status = NONAKTIF) tanpa hapus akun.
  if (method === "DELETE") {
    const query = getQuery(event);
    const softDelete = query.soft === "true";

    try {
      if (softDelete) {
        const updated = await db.employee.update({
          where: { id },
          data: { status: "NONAKTIF" },
          include: {
            user: { select: { id: true, name: true, email: true, role: true } },
          },
        });

        return {
          success: true,
          message: "Karyawan berhasil dinonaktifkan",
          data: sanitizeEmployee(updated),
        };
      }

      // Hard delete: hapus User (Employee ikut terhapus karena onDelete: Cascade)
      await db.user.delete({ where: { id: existingEmployee.userId } });
      await deletePhotoFile(existingEmployee.photo);

      return {
        success: true,
        message: "Karyawan berhasil dihapus secara permanen",
      };
    } catch (error: any) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2025"
      ) {
        throw createError({
          statusCode: 404,
          message: "Karyawan tidak ditemukan.",
        });
      }

      console.error("Gagal menghapus karyawan:", error);
      throw createError({
        statusCode: 500,
        message: "Gagal menghapus karyawan.",
      });
    }
  }

  throw createError({ statusCode: 405, message: "Method not allowed" });
});
