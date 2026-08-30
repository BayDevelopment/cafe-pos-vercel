// server/api/auth/forgot-password.post.ts
import { defineEventHandler, getMethod, readBody, createError } from "h3";
import crypto from "node:crypto";
import { db } from "../../utils/db";
import { rateLimitByIpAndIdentifier } from "../../utils/rateLimiter";
import { sendEmail } from "../../utils/mailer";
import { Role } from "../../../generated/prisma/client";

const MAX_EMAIL_LEN = 255;
const TOKEN_TTL_MS = 30 * 60 * 1000;

const GENERIC_RESPONSE_MESSAGE = "Jika email tersebut terdaftar, kami telah mengirimkan link untuk mengatur ulang password.";

function hashToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

// Path login berbeda per role — dipakai untuk link "kembali ke login" di email
// dan supaya reset-password.vue tahu ke mana redirect setelah sukses.
function loginPathForRole(role: string): string {
  return role === Role.PEMILIK ? "/owner/login" : "/kasir/login";
}

function roleLabel(role: string): string {
  return role === Role.PEMILIK ? "Pemilik Toko" : "Kasir";
}

async function sendResetPasswordEmail(email: string, name: string, role: string, rawToken: string) {
  const resetUrl = `${process.env.APP_URL || "http://localhost:3000"}/auth/reset-password?token=${rawToken}`;
  const label = roleLabel(role);

  // Pesan dipersonalisasi (nama & role) supaya user yakin email ini memang
  // untuk akunnya, dan untuk akun Pemilik ditambah catatan ekstra karena
  // aksesnya lebih luas (semua data toko) dibanding Kasir.
  const extraNote =
    role === Role.PEMILIK
      ? `<p style="color:#8A7A68; font-size:13px;">Akun ini memiliki akses penuh sebagai <strong>Pemilik Toko</strong>. Jika kamu tidak merasa meminta reset ini, segera hubungi tim teknis.</p>`
      : "";

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h2 style="color:#2b1b12;">Reset Password</h2>
      <p>Halo ${name ? name : label},</p>
      <p>Kami menerima permintaan untuk mengatur ulang password akun <strong>${label}</strong> kamu di Kedai Kopi POS.</p>
      <p>
        <a href="${resetUrl}"
           style="display:inline-block; background:#2b1b12; color:#faf6ee; padding:12px 24px; border-radius:8px; text-decoration:none; font-weight:600;">
          Atur Ulang Password
        </a>
      </p>
      <p style="color:#8A7A68; font-size:13px;">
        Link ini berlaku selama 30 menit. Kalau kamu tidak merasa meminta reset password,
        abaikan saja email ini — password kamu tidak akan berubah.
      </p>
      ${extraNote}
    </div>
  `;

  await sendEmail(email, "Reset Password - Kedai Kopi POS", html);
}

export default defineEventHandler(async (event) => {
  if (getMethod(event) !== "POST") {
    throw createError({ statusCode: 405, statusMessage: "Method not allowed" });
  }

  let body: any;
  try {
    body = await readBody(event);
  } catch {
    throw createError({ statusCode: 400, statusMessage: "Body request tidak valid." });
  }

  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";

  if (!email || email.length > MAX_EMAIL_LEN) {
    throw createError({ statusCode: 400, statusMessage: "Email tidak valid." });
  }

  await rateLimitByIpAndIdentifier(event, email, "forgot-password", { maxAttempts: 5, windowMs: 60 * 1000 });

  try {
    const user = await db.user.findUnique({ where: { email } });

    if (user && user.isActive) {
      const rawToken = crypto.randomBytes(32).toString("hex");
      const hashedToken = hashToken(rawToken);

      await db.$transaction([
        db.passwordResetToken.deleteMany({
          where: { userId: user.id, usedAt: null },
        }),
        db.passwordResetToken.create({
          data: {
            token: hashedToken,
            userId: user.id,
            expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
          },
        }),
      ]);

      // Fire-and-forget: tidak di-await, supaya waktu respons konsisten baik
      // email terdaftar maupun tidak (mencegah timing attack / user enumeration).
      sendResetPasswordEmail(user.email, user.name, user.role, rawToken).catch((err) => {
        console.error(`Gagal mengirim email reset password ke ${user.email}:`, err);
      });
    }

    return { success: true, message: GENERIC_RESPONSE_MESSAGE };
  } catch (error: any) {
    if (error?.statusCode) throw error;
    console.error("Forgot password error:", error);
    return { success: true, message: GENERIC_RESPONSE_MESSAGE };
  }
});