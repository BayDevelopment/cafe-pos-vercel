import type { H3Event } from "h3";
import { getCookie, getHeader, deleteCookie, createError } from "h3";
import jwt from "jsonwebtoken";
import { db } from "./db";
import { Role } from '../../generated/prisma/client'

export interface AuthUser {
  id: string;
  role: Role;
}

interface JwtPayload {
  userId?: string;
  id?: string;
  role?: string;
  iat?: number; // epoch detik, otomatis diisi jsonwebtoken saat jwt.sign
}

function verifyToken(event: H3Event): JwtPayload | null {
  let token = getCookie(event, "auth_token") || getCookie(event, "token");

  if (!token) {
    const authHeader = getHeader(event, "authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.substring(7);
    }
  }

  if (!token) return null;

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw createError({
      statusCode: 500,
      statusMessage: "Konfigurasi server tidak lengkap (JWT_SECRET belum diset).",
    });
  }

  try {
    return jwt.verify(token, jwtSecret, { algorithms: ["HS256"] }) as JwtPayload;
  } catch {
    deleteCookie(event, "auth_token", { path: "/" });
    deleteCookie(event, "token", { path: "/" });
    return null;
  }
}

export async function getAuthUser(event: H3Event): Promise<AuthUser | null> {
  const cached = event.context.user as AuthUser | undefined;
  if (cached?.id && cached?.role) return cached;

  const payload = verifyToken(event);
  if (!payload) return null;

  const rawId = payload.userId ?? payload.id;
  const rawRole = String(payload.role || "").toUpperCase();

  if (!rawId || (rawRole !== Role.PEMILIK && rawRole !== Role.KASIR)) {
    return null;
  }

  const dbUser = await db.user.findUnique({
    where: { id: rawId },
    select: { role: true, isActive: true, passwordChangedAt: true },
  });

  if (!dbUser || !dbUser.isActive) return null;
  if (dbUser.role !== (rawRole as Role)) return null;

  // Tolak token yang diterbitkan SEBELUM password terakhir diganti.
  // Ini memastikan begitu user ganti password, semua token/sesi lama
  // (termasuk yang mungkin sudah dicuri) langsung tidak berlaku lagi,
  // tanpa perlu blocklist token terpisah.
  if (dbUser.passwordChangedAt && payload.iat) {
    const tokenIssuedAtMs = payload.iat * 1000; // iat dalam detik, Date dalam ms
    if (tokenIssuedAtMs < dbUser.passwordChangedAt.getTime()) {
      return null;
    }
  }

  const user: AuthUser = { id: rawId, role: dbUser.role };
  event.context.user = user;
  return user;
}

export async function identifyUser(event: H3Event): Promise<void> {
  try {
    await getAuthUser(event);
  } catch (err: any) {
    if (err?.statusCode === 500) throw err;
  }
}

export async function requireUser(event: H3Event): Promise<AuthUser> {
  const user = await getAuthUser(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Anda harus login untuk mengakses fitur ini." });
  }
  return user;
}

export async function requireOwner(event: H3Event): Promise<AuthUser> {
  const user = await requireUser(event);
  if (user.role !== Role.PEMILIK) {
    throw createError({ statusCode: 403, statusMessage: "Akses ditolak: Hanya Pemilik Toko yang berhak mengakses fitur ini." });
  }
  return user;
}