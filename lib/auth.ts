import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

export { canExport, canManageLocations, canManageRequests, canWriteOff } from "@/lib/permissions";

const cookieName = "rope_user";

export async function login(loginValue: string, password: string) {
  const user = await prisma.user.findUnique({ where: { login: loginValue } });
  if (!user) return false;

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return false;

  const cookieStore = await cookies();
  cookieStore.set(cookieName, String(user.id), {
    httpOnly: true,
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
  const id = cookieStore.get(cookieName)?.value;
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
