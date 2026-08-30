import assert from "node:assert/strict";
import { test } from "node:test";
import { sessionCookieOptions } from "../lib/session-cookie";

test("production session cookies require HTTPS by default", () => {
  for (const value of [undefined, "", "true", "FALSE", "invalid"]) {
    assert.equal(sessionCookieOptions({ NODE_ENV: "production", AUTH_COOKIE_SECURE: value }).secure, true);
  }
});

test("local production preview explicitly supports HTTP without weakening other session attributes", () => {
  assert.deepEqual(sessionCookieOptions({ NODE_ENV: "production", AUTH_COOKIE_SECURE: "false" }), {
    httpOnly: true, secure: false, sameSite: "lax", path: "/", maxAge: 2592000
  });
});

test("development defaults to HTTP but allows HTTPS", () => {
  assert.equal(sessionCookieOptions({ NODE_ENV: "development" }).secure, false);
  assert.equal(sessionCookieOptions({ NODE_ENV: "development", AUTH_COOKIE_SECURE: "true" }).secure, true);
});
