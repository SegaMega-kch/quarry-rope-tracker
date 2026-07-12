import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

const cookieName = "rope_user";

export async function login(loginValue: string, password: string) {
  const user = await prisma.user.findUnique({ where: { login: loginValue } });
  if (!user) return false;

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return false;

  cookies().set(cookieName, String(user.id), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30
  });
  return true;
}

export function logout() {
  cookies().delete(cookieName);
}

export async function getCurrentUser() {
  const id = cookies().get(cookieName)?.value;
  if (!id) return null;
  return prisma.user.findUnique({
    where: { id: Number(id) },
    select: { id: true, login: true, role: true }
  });
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export function canWriteOff(role: string) {
  return role === "boss" || role === "storekeeper" || role === "admin";
}

export function canExport(role: string) {
  return role === "boss" || role === "storekeeper" || role === "admin";
}

export function canManageLocations(role: string) {
  return role === "storekeeper" || role === "admin";
}

export function canManageRequests(role: string) {
  return role === "boss" || role === "admin";
}
