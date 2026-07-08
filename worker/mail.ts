/// <reference types="@cloudflare/workers-types" />

import type { Env } from "./index";

type EmailResult =
  | { sent: true }
  | { sent: false; reason: string; loginUrl?: string; downloadUrl?: string };

async function sendEmail(
  env: Env,
  payload: {
    to: string;
    subject: string;
    html: string;
  }
): Promise<EmailResult> {
  if (!env.RESEND_API_KEY || !env.ADMIN_EMAIL_FROM) {
    return {
      sent: false,
      reason: "Email environment variables are not configured"
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
      to: payload.to,
      subject: payload.subject,
      html: payload.html
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    return {
      sent: false,
      reason: errorText
    };
  }

  return { sent: true };
}

export async function sendAdminLoginEmail(
  env: Env,
  email: string,
  loginUrl: string
): Promise<EmailResult> {
  const result = await sendEmail(env, {
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
  });

  if (!result.sent) {
    return {
      ...result,
      loginUrl
    };
  }

  return result;
}

export async function sendLeadMagnetEmail(
  env: Env,
  email: string,
  options: {
    title: string;
    downloadUrl: string;
    description?: string;
  }
): Promise<EmailResult> {
  const result = await sendEmail(env, {
    to: email,
    subject: `Your download: ${options.title}`,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827">
        <h2>Your download is ready</h2>

        <p>
          Thanks for requesting <strong>${options.title}</strong>.
        </p>

        ${
          options.description
            ? `<p>${options.description}</p>`
            : ""
        }

        <p>
          <a href="${options.downloadUrl}" style="display:inline-block;background:#f31635;color:#ffffff;padding:12px 18px;border-radius:999px;text-decoration:none;font-weight:bold">
            Download Now
          </a>
        </p>

        <p style="color:#6b7280;font-size:14px">
          If the button does not work, copy and paste this link into your browser:<br />
          ${options.downloadUrl}
        </p>
      </div>
    `
  });

  if (!result.sent) {
    return {
      ...result,
      downloadUrl: options.downloadUrl
    };
  }

  return result;
}