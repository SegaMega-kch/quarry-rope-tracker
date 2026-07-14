import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { LoginForm } from "./LoginForm";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/rope");

  return (
    <main className="login-page">
      <LoginForm />
    </main>
  );
}
