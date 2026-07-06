/// <reference types="@cloudflare/workers-types" />

import type { Env } from "./index";
import { requireAdmin } from "./auth";
import { json } from "./utils";

export async function handleAdminRoutes(
  request: Request,
  env: Env
): Promise<Response | null> {
  const url = new URL(request.url);

  if (!url.pathname.startsWith("/api/admin/")) {
    return null;
  }

  const publicAdminRoutes = [
    "/api/admin/send-login-link",
    "/api/admin/verify",
    "/api/admin/session",
    "/api/admin/logout"
  ];

  if (publicAdminRoutes.includes(url.pathname)) {
    return null;
  }

  const unauthorized = await requireAdmin(request, env);
  if (unauthorized) return unauthorized;

  if (request.method === "GET" && url.pathname === "/api/admin/dashboard") {
    const totals = await env.DB.prepare(`
      SELECT
        COUNT(*) AS total_leads,
        SUM(CASE WHEN date(created_at) = date('now') THEN 1 ELSE 0 END) AS todays_leads,
        SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) AS new_leads
      FROM leads
    `).first();

    const recentLeads = await env.DB.prepare(`
      SELECT
        leads.id,
        leads.full_name,
        leads.email,
        leads.phone,
        leads.company,
        leads.source,
        leads.status,
        leads.created_at,
        campaigns.name AS campaign_name
      FROM leads
      LEFT JOIN campaigns ON campaigns.id = leads.campaign_id
      ORDER BY leads.created_at DESC
      LIMIT 50
    `).all();

    return json({
      success: true,
      totals,
      recent_leads: recentLeads.results
    });
  }

  if (request.method === "GET" && url.pathname === "/api/admin/leads") {
    const leads = await env.DB.prepare(`
      SELECT
        leads.id,
        leads.full_name,
        leads.email,
        leads.phone,
        leads.company,
        leads.message,
        leads.source,
        leads.status,
        leads.created_at,
        campaigns.name AS campaign_name,
        pages.title AS page_title,
        forms.name AS form_name
      FROM leads
      LEFT JOIN campaigns ON campaigns.id = leads.campaign_id
      LEFT JOIN pages ON pages.id = leads.page_id
      LEFT JOIN forms ON forms.id = leads.form_id
      ORDER BY leads.created_at DESC
      LIMIT 500
    `).all();

    return json({
      success: true,
      leads: leads.results
    });
  }

  if (request.method === "GET" && url.pathname === "/api/admin/campaigns") {
    const campaigns = await env.DB.prepare(`
      SELECT
        campaigns.id,
        campaigns.campaign_key,
        campaigns.name,
        campaigns.description,
        campaigns.status,
        campaigns.created_at,
        COUNT(leads.id) AS lead_count
      FROM campaigns
      LEFT JOIN leads ON leads.campaign_id = campaigns.id
      GROUP BY campaigns.id
      ORDER BY campaigns.created_at DESC
    `).all();

    return json({
      success: true,
      campaigns: campaigns.results
    });
  }

  if (request.method === "GET" && url.pathname === "/api/admin/pages") {
    const pages = await env.DB.prepare(`
      SELECT
        pages.id,
        pages.page_key,
        pages.slug,
        pages.title,
        pages.page_type,
        pages.status,
        pages.created_at,
        campaigns.name AS campaign_name,
        COUNT(leads.id) AS lead_count
      FROM pages
      LEFT JOIN campaigns ON campaigns.id = pages.campaign_id
      LEFT JOIN leads ON leads.page_id = pages.id
      GROUP BY pages.id
      ORDER BY pages.created_at DESC
    `).all();

    return json({
      success: true,
      pages: pages.results
    });
  }

  return json(
    {
      success: false,
      error: "Admin route not found",
      path: url.pathname
    },
    404
  );
}