"use client";

import { useFormState, useFormStatus } from "react-dom";
import { loginAction } from "@/app/actions";

function Button() {
  const { pending } = useFormStatus();
  return <button className="primary big" disabled={pending}>{pending ? "Вход..." : "Войти"}</button>;
}

export function LoginForm() {
  const [state, action] = useFormState(loginAction, null);

  return (
    <form action={action} className="login-card">
      <h1>Рапорт мастера</h1>
      <label>
        Логин
        <input name="login" placeholder="например: 1 смена" required />
      </label>
      <label>
        Пароль
        <input name="password" type="password" required />
      </label>
      {state?.error ? <p className="error">{state.error}</p> : null}
      <Button />
    </form>
  );
}
