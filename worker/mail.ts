/// <reference types="@cloudflare/workers-types" />

import type { Env } from "./index";

export async function sendAdminLoginEmail(env: Env, email: string, loginUrl: string) {
  if (!env.RESEND_API_KEY || !env.ADMIN_EMAIL_FROM) {
    return {
      sent: false,
      reason: "Email environment variables are not configured",
      loginUrl
    };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: env.ADMIN_EMAIL_FROM,
      to: email,
      subject: "Your Liwox Forms admin login link",
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827">
          <h2>Liwox Forms Admin Access</h2>
          <p>Click the secure link below to access your admin dashboard.</p>
          <p>
            <a href="${loginUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:bold">
              Open Admin Dashboard
            </a>
          </p>
          <p>This link expires shortly and can only be used once.</p>
        </div>
      `
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    return { sent: false, reason: errorText, loginUrl };
  }

  return { sent: true };
}