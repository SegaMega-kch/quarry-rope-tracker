type SessionEnvironment = { NODE_ENV?: string; AUTH_COOKIE_SECURE?: string };

export function sessionCookieOptions(environment: SessionEnvironment = process.env) {
  // Production stays HTTPS-only unless the local HTTP reviewer opts out explicitly.
  const secure = environment.AUTH_COOKIE_SECURE === "false"
    ? false
    : environment.AUTH_COOKIE_SECURE === "true" || environment.NODE_ENV === "production";

  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 24 * 30
  };
}
