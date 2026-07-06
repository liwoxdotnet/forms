/// <reference types="@cloudflare/workers-types" />

import type { Env } from "./index";
import { addMinutes, json, randomToken, readJson, text } from "./utils";
import { sendAdminLoginEmail } from "./mail";

const ADMIN_SESSION_COOKIE = "liwox_admin_session";
const DEFAULT_ADMIN_BASE_URL = "https://forms.liwox.net";

function getCookie(request: Request, name: string) {
  const cookieHeader = request.headers.get("Cookie") || "";
  const cookies = cookieHeader.split(";");

  for (const cookie of cookies) {
    const [key, ...rest] = cookie.trim().split("=");
    if (key === name) return rest.join("=");
  }

  return null;
}

function getBearerToken(request: Request) {
  const header = request.headers.get("Authorization") || "";
  if (!header.startsWith("Bearer ")) return null;
  return header.replace("Bearer ", "").trim();
}

export function getAdminTokenFromRequest(request: Request) {
  return getBearerToken(request) || getCookie(request, ADMIN_SESSION_COOKIE);
}

export async function validateAdminSession(request: Request, env: Env) {
  const token = getAdminTokenFromRequest(request);
  if (!token) return null;

  const session = await env.DB.prepare(`
    SELECT
      admin_tokens.email,
      admin_tokens.token,
      admin_tokens.expires_at,
      admin_tokens.used_at,
      admin_users.email AS allowed_email
    FROM admin_tokens
    JOIN admin_users ON admin_users.email = admin_tokens.email
    WHERE admin_tokens.token = ?
    LIMIT 1
  `).bind(token).first<any>();

  if (!session) return null;
  if (!session.used_at) return null;
  if (new Date(session.expires_at) < new Date()) return null;

  return {
    email: session.email,
    token: session.token
  };
}

export async function requireAdmin(request: Request, env: Env) {
  const admin = await validateAdminSession(request, env);

  if (!admin) {
    return json(
      {
        success: false,
        error: "Unauthorized"
      },
      401,
      request
    );
  }

  return null;
}

export async function handleAuthRoutes(
  request: Request,
  env: Env
): Promise<Response | null> {
  const url = new URL(request.url);

  if (request.method === "POST" && url.pathname === "/api/admin/send-login-link") {
    const body = await readJson(request);
    const email = text(body.email)?.toLowerCase();

    if (!email) {
      return json(
        {
          success: false,
          error: "Email is required"
        },
        400,
        request
      );
    }

    const adminUser = await env.DB.prepare(`
      SELECT id, email
      FROM admin_users
      WHERE email = ?
      LIMIT 1
    `).bind(email).first<any>();

    if (!adminUser) {
      return json(
        {
          success: false,
          error: "This email is not allowed to access Liwox Forms admin."
        },
        403,
        request
      );
    }

    const token = randomToken();
    const expiresAt = addMinutes(15);

    await env.DB.prepare(`
      INSERT INTO admin_tokens (
        email,
        token,
        expires_at
      ) VALUES (?, ?, ?)
    `).bind(email, token, expiresAt).run();

    const frontendBase = env.ADMIN_BASE_URL || DEFAULT_ADMIN_BASE_URL;

    const verifyUrl =
      `${url.origin}/api/admin/verify?token=${encodeURIComponent(token)}`;

    const fallbackAdminUrl =
      `${frontendBase}/admin?admin_token=${encodeURIComponent(token)}`;

    const mailResult = await sendAdminLoginEmail(env, email, verifyUrl);

    return json(
      {
        success: true,
        message: mailResult.sent
          ? "Login link sent successfully."
          : "Login link generated. Email sending is not configured yet.",
        email_sent: mailResult.sent,
        expires_at: expiresAt,
        login_url: mailResult.sent ? undefined : verifyUrl,
        admin_url: mailResult.sent ? undefined : fallbackAdminUrl
      },
      200,
      request
    );
  }

  if (request.method === "GET" && url.pathname === "/api/admin/verify") {
    const token = text(url.searchParams.get("token"));

    if (!token) {
      return json(
        {
          success: false,
          error: "Token is required"
        },
        400,
        request
      );
    }

    const record = await env.DB.prepare(`
      SELECT
        admin_tokens.email,
        admin_tokens.token,
        admin_tokens.expires_at,
        admin_tokens.used_at,
        admin_users.email AS allowed_email
      FROM admin_tokens
      JOIN admin_users ON admin_users.email = admin_tokens.email
      WHERE admin_tokens.token = ?
      LIMIT 1
    `).bind(token).first<any>();

    if (!record) {
      return json(
        {
          success: false,
          error: "Invalid login token"
        },
        400,
        request
      );
    }

    if (record.used_at) {
      return json(
        {
          success: false,
          error: "This login link has already been used"
        },
        400,
        request
      );
    }

    if (new Date(record.expires_at) < new Date()) {
      return json(
        {
          success: false,
          error: "This login link has expired"
        },
        400,
        request
      );
    }

    const sessionExpiresAt = addMinutes(60 * 24);

    await env.DB.prepare(`
      UPDATE admin_tokens
      SET
        used_at = CURRENT_TIMESTAMP,
        expires_at = ?
      WHERE token = ?
    `).bind(sessionExpiresAt, token).run();

    const frontendBase = env.ADMIN_BASE_URL || DEFAULT_ADMIN_BASE_URL;
    const redirectUrl =
      `${frontendBase}/admin?admin_token=${encodeURIComponent(token)}`;

    return new Response(null, {
      status: 302,
      headers: {
        Location: redirectUrl,
        "Set-Cookie": `${ADMIN_SESSION_COOKIE}=${token}; HttpOnly; Secure; Path=/; Max-Age=86400; SameSite=Lax`
      }
    });
  }

  if (request.method === "GET" && url.pathname === "/api/admin/session") {
    const admin = await validateAdminSession(request, env);

    if (!admin) {
      return json(
        {
          success: false,
          authenticated: false
        },
        401,
        request
      );
    }

    return json(
      {
        success: true,
        authenticated: true,
        admin: {
          email: admin.email
        }
      },
      200,
      request
    );
  }

  if (request.method === "POST" && url.pathname === "/api/admin/logout") {
    const token = getAdminTokenFromRequest(request);

    if (token) {
      await env.DB.prepare(`
        UPDATE admin_tokens
        SET expires_at = CURRENT_TIMESTAMP
        WHERE token = ?
      `).bind(token).run();
    }

    return json(
      {
        success: true,
        message: "Logged out successfully"
      },
      200,
      request
    );
  }

  return null;
}