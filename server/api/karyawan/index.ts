// server/api/karyawan/index.ts
import {
  defineEventHandler,
  getMethod,
  getQuery,
  readMultipartFormData,
  createError,
} from "h3";
import { put, del } from "@vercel/blob";
import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { Prisma } from "../../../generated/prisma/client";
import { db } from "../../utils/db";
import { requireOwner } from "../../utils/auth";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 10;
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

// Generate kode karyawan otomatis, format: KRY-0001, KRY-0002, dst.
async function generateEmployeeCode(): Promise<string> {
  const last = await db.employee.findFirst({
    orderBy: { employeeCode: "desc" },
    select: { employeeCode: true },
  });

  let nextNumber = 1;
  if (last?.employeeCode) {
    const match = last.employeeCode.match(/(\d+)$/);
    if (match && match[1]) {
      nextNumber = parseInt(match[1], 10) + 1;
    }
  }

  return `KRY-${String(nextNumber).padStart(4, "0")}`;
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

export default defineEventHandler(async (event) => {
  const method = getMethod(event);

  // 1. GET Daftar Karyawan — HANYA PEMILIK
  if (method === "GET") {
    await requireOwner(event);

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

      let status: EmployeeStatusValue | undefined;
      if (
        typeof query.status === "string" &&
        isValidEmployeeStatus(query.status)
      ) {
        status = query.status;
      }

      const position = query.position
        ? String(query.position).trim().slice(0, MAX_POSITION_LEN)
        : "";

      const where: Prisma.EmployeeWhereInput = {};

      if (search) {
        where.OR = [
          { employeeCode: { contains: search, mode: "insensitive" } },
          { phone: { contains: search, mode: "insensitive" } },
          { position: { contains: search, mode: "insensitive" } },
          // ⚠️ SESUAIKAN nama field pada User (mis. name / fullName)
          { user: { name: { contains: search, mode: "insensitive" } } },
          { user: { email: { contains: search, mode: "insensitive" } } },
        ];
      }

      if (status) where.status = status;
      if (position)
        where.position = { contains: position, mode: "insensitive" };

      const [employees, totalItems] = await Promise.all([
        db.employee.findMany({
          where,
          include: {
            // ⚠️ SESUAIKAN select field User yang boleh diekspos (jangan select password!)
            user: {
              select: { id: true, name: true, email: true, role: true },
            },
          },
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
        }),
        db.employee.count({ where }),
      ]);

      return {
        success: true,
        data: employees.map(sanitizeEmployee),
        pagination: {
          currentPage: page,
          perPage: limit,
          totalItems,
          totalPages: Math.ceil(totalItems / limit) || 1,
        },
      };
    } catch (error: any) {
      if (error?.statusCode) throw error;
      console.error("Gagal mengambil data karyawan:", error);
      throw createError({
        statusCode: 500,
        message: "Gagal mengambil data karyawan.",
      });
    }
  }

  // 2. POST Tambah Karyawan — HANYA PEMILIK
  if (method === "POST") {
    await requireOwner(event);

    const files = await readMultipartFormData(event);
    if (!files) {
      throw createError({ statusCode: 400, message: "Invalid form data" });
    }

    let name = "";
    let email = "";
    let password = "";
    let phone = "";
    let address = "";
    let birthDateRaw = "";
    let position = "";
    let statusRaw = "AKTIF";
    let joinDateRaw = "";
    let uploadedFile: { filename: string; data: Buffer } | null = null;

    for (const file of files) {
      const fieldName = file.name;
      const value = file.data.toString("utf-8");

      if (fieldName === "name") name = value.trim();
      if (fieldName === "email") email = value.trim().toLowerCase();
      if (fieldName === "password") password = value;
      if (fieldName === "phone") phone = value.trim();
      if (fieldName === "address") address = value.trim();
      if (fieldName === "birthDate") birthDateRaw = value.trim();
      if (fieldName === "position") position = value.trim();
      if (fieldName === "status") statusRaw = value.trim();
      if (fieldName === "joinDate") joinDateRaw = value.trim();

      if (fieldName === "photo" && file.filename && file.data.length > 0) {
        uploadedFile = { filename: file.filename, data: file.data };
      }
    }

    // --- VALIDASI ---
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

    if (!email || !isValidEmail(email)) {
      throw createError({ statusCode: 400, message: "Email tidak valid." });
    }

    if (!password || password.length < 6) {
      throw createError({
        statusCode: 400,
        message: "Password minimal 6 karakter.",
      });
    }

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
    await ensurePhoneUnique(phone);

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

    if (address.length > MAX_ADDRESS_LEN) {
      throw createError({
        statusCode: 400,
        message: `Alamat tidak boleh melebihi ${MAX_ADDRESS_LEN} karakter.`,
      });
    }

    if (position.length > MAX_POSITION_LEN) {
      throw createError({
        statusCode: 400,
        message: `Jabatan tidak boleh melebihi ${MAX_POSITION_LEN} karakter.`,
      });
    }

    const status: EmployeeStatusValue = isValidEmployeeStatus(statusRaw)
      ? statusRaw
      : "AKTIF";

    let birthDate: Date | null = null;
    if (birthDateRaw) {
      const parsed = new Date(birthDateRaw);
      if (Number.isNaN(parsed.getTime())) {
        throw createError({
          statusCode: 400,
          message: "Format tanggal lahir tidak valid.",
        });
      }
      birthDate = parsed;
    }

    let joinDate: Date | undefined;
    if (joinDateRaw) {
      const parsed = new Date(joinDateRaw);
      if (Number.isNaN(parsed.getTime())) {
        throw createError({
          statusCode: 400,
          message: "Format tanggal bergabung tidak valid.",
        });
      }
      joinDate = parsed;
    }

    let photoPath: string | null = null;
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
      photoPath = blob.url; // langsung URL publik, tidak perlu proxy endpoint
    }

    const cleanupUploadedFile = async () => {
      if (savedBlobUrl) {
        await del(savedBlobUrl, {
          token: process.env.BLOB_READ_WRITE_TOKEN,
        }).catch(() => {});
      }
    };

    try {
      const hashedPassword = await bcrypt.hash(password, 10);
      const employeeCode = await generateEmployeeCode();

      // Buat User + Employee dalam satu transaksi agar konsisten
      const result = await db.$transaction(async (tx) => {
        const newUser = await tx.user.create({
          data: {
            // ⚠️ SESUAIKAN nama field sesuai schema User kamu
            name,
            email,
            password: hashedPassword,
            role: "KASIR",
          } as any,
        });

        const newEmployee = await tx.employee.create({
          data: {
            userId: newUser.id,
            employeeCode,
            phone,
            address: address || null,
            birthDate,
            photo: photoPath,
            position: position || null,
            status,
            ...(joinDate ? { joinDate } : {}),
          },
          include: {
            user: { select: { id: true, name: true, email: true, role: true } },
          },
        });

        return newEmployee;
      });

      return {
        success: true,
        message: "Karyawan berhasil ditambahkan",
        data: sanitizeEmployee(result),
      };
    } catch (error: any) {
      await cleanupUploadedFile();

      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === "P2002") {
          const target = Array.isArray(error.meta?.target)
            ? error.meta?.target.join(", ")
            : String(error.meta?.target ?? "");
          const message = target.includes("phone")
            ? "Nomor telepon sudah digunakan oleh karyawan lain."
            : `Data sudah terdaftar (${target || "email/kode karyawan"}).`;
          throw createError({ statusCode: 409, message });
        }
      }

      console.error("Gagal menambah karyawan:", error);
      throw createError({
        statusCode: 500,
        message: "Gagal menambah karyawan. Silakan coba lagi.",
      });
    }
  }

  throw createError({ statusCode: 405, message: "Method not allowed" });
});
