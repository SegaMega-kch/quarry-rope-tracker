import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { createHmac, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";

export { canExport, canManageLocations, canManageRequests, canWriteOff } from "@/lib/permissions";

const cookieName = "rope_user";

function sessionSecret() {
  const secret = process.env.AUTH_SECRET || process.env.SESSION_SECRET || "";
  if (process.env.NODE_ENV === "production" && (!secret || ["local-dev", "replace-me"].includes(secret))) {
    throw new Error("AUTH_SECRET must be set to a strong random value");
  }
  return secret || "local-dev-session-secret-change-on-server";
}

function signUserId(id: number) {
  const value = String(id);
  const signature = createHmac("sha256", sessionSecret()).update(value).digest("base64url");
  return `${value}.${signature}`;
}

function verifyUserCookie(value?: string) {
  if (!value) return null;
  const [rawId, signature] = value.split(".");
  const id = Number(rawId);
  if (!Number.isInteger(id) || id < 1 || !signature) return null;

  const expected = createHmac("sha256", sessionSecret()).update(rawId).digest("base64url");
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (signatureBuffer.length !== expectedBuffer.length) return null;
  return timingSafeEqual(signatureBuffer, expectedBuffer) ? id : null;
}

export async function login(loginValue: string, password: string) {
  const user = await prisma.user.findUnique({ where: { login: loginValue } });
  if (!user) return false;

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return false;

  const cookieStore = await cookies();
  cookieStore.set(cookieName, signUserId(user.id), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30
  });
  return true;
}

export async function logout() {
  const cookieStore = await cookies();
  cookieStore.delete(cookieName);
}

export async function getCurrentUser() {
  const cookieStore = await cookies();
  const id = verifyUserCookie(cookieStore.get(cookieName)?.value);
  if (!id) return null;
  return prisma.user.findUnique({
    where: { id },
    select: { id: true, login: true, role: true }
  });
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
