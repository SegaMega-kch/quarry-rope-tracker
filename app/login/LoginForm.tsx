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
      <h1>Учёт канатов</h1>
      <label>
        Логин
        <input name="login" placeholder="например: 1 смена" required />
      </label>
      <label>
        Пароль
        <input name="password" type="password" defaultValue="123456" required />
      </label>
      {state?.error ? <p className="error">{state.error}</p> : null}
      <Button />
      <p className="muted">Начальный пароль для всех пользователей: 123456</p>
    </form>
  );
}
