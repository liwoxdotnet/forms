/// <reference types="@cloudflare/workers-types" />

import type { Env } from "./index";
import { json, readJson, text } from "./utils";
import { sendLeadMagnetEmail } from "./mail";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getClientMeta(request: Request) {
  return {
    user_agent: request.headers.get("User-Agent") || "",
    ip_address:
      request.headers.get("CF-Connecting-IP") ||
      request.headers.get("X-Forwarded-For") ||
      "",
    referrer: request.headers.get("Referer") || ""
  };
}

async function getCampaignByKey(env: Env, campaignKey: string | null) {
  if (!campaignKey) return null;

  return await env.DB.prepare(
    "SELECT id, campaign_key, name FROM campaigns WHERE campaign_key = ?"
  )
    .bind(campaignKey)
    .first<any>();
}

async function getPageByKey(env: Env, pageKey: string | null) {
  if (!pageKey) return null;

  return await env.DB.prepare(
    "SELECT id, page_key, slug, title FROM pages WHERE page_key = ?"
  )
    .bind(pageKey)
    .first<any>();
}

async function getPageBySlug(env: Env, slug: string | null) {
  if (!slug) return null;

  return await env.DB.prepare(`
    SELECT
      pages.id,
      pages.campaign_id,
      pages.page_key,
      pages.slug,
      pages.title,
      pages.page_type,
      pages.status,
      pages.created_at,
      pages.updated_at,
      campaigns.name AS campaign_name,
      campaigns.campaign_key
    FROM pages
    LEFT JOIN campaigns ON campaigns.id = pages.campaign_id
    WHERE pages.slug = ? OR pages.page_key = ?
    LIMIT 1
  `)
    .bind(slug, slug)
    .first<any>();
}

async function getFormByKey(env: Env, formKey: string | null) {
  if (!formKey) return null;

  return await env.DB.prepare(
    "SELECT id, form_key, name FROM forms WHERE form_key = ?"
  )
    .bind(formKey)
    .first<any>();
}

async function ensureCampaign(env: Env, campaignKey: string, name?: string) {
  const existing = await getCampaignByKey(env, campaignKey);
  if (existing) return existing;

  const result = await env.DB.prepare(`
    INSERT INTO campaigns (
      campaign_key,
      name,
      description,
      status
    ) VALUES (?, ?, ?, ?)
  `)
    .bind(
      campaignKey,
      name || campaignKey.replace(/-/g, " "),
      "Auto-created campaign",
      "active"
    )
    .run();

  return {
    id: result.meta.last_row_id,
    campaign_key: campaignKey,
    name: name || campaignKey
  };
}

async function createEvent(
  env: Env,
  leadId: number | null,
  eventType: string,
  eventData: Record<string, JsonValue>
) {
  await env.DB.prepare(`
    INSERT INTO events (
      lead_id,
      event_type,
      event_data
    ) VALUES (?, ?, ?)
  `)
    .bind(leadId, eventType, JSON.stringify(eventData))
    .run();
}

export async function handleApiRoutes(
  request: Request,
  env: Env
): Promise<Response | null> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/api/health") {
    return json({
      success: true,
      status: "ok",
      service: "liwox-forms-api",
      timestamp: new Date().toISOString()
    });
  }

  if (request.method === "POST" && url.pathname === "/api/deliver-lead-magnet") {
    const body = await readJson(request);
    const meta = getClientMeta(request);

    const email = text(body.email);
    const fullName = text(body.full_name);
    const phone = text(body.phone);
    const campaignKey = text(body.campaign_key) || "lead-magnet";
    const pageKey = text(body.page_key);
    const formKey = text(body.form_key);
    const source = text(body.source) || "lead_magnet";
    const title = text(body.title) || "Your Download";
    const description = text(body.description);
    const downloadUrl = text(body.download_url);

    if (!email) {
      return json({ success: false, error: "Email is required" }, 400);
    }

    if (!downloadUrl) {
      return json({ success: false, error: "download_url is required" }, 400);
    }

    let campaign = await getCampaignByKey(env, campaignKey);
    if (!campaign && campaignKey) campaign = await ensureCampaign(env, campaignKey);

    const page = pageKey ? await getPageByKey(env, pageKey) : null;
    const form = formKey ? await getFormByKey(env, formKey) : null;

    const leadResult = await env.DB.prepare(`
      INSERT INTO leads (
        campaign_id,
        page_id,
        form_id,
        full_name,
        email,
        phone,
        company,
        message,
        source,
        utm_source,
        utm_medium,
        utm_campaign,
        utm_term,
        utm_content,
        referrer,
        user_agent,
        ip_address,
        status,
        raw_payload
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(
        campaign?.id || null,
        page?.id || null,
        form?.id || null,
        fullName,
        email,
        phone,
        text(body.company),
        `Requested lead magnet: ${title}`,
        source,
        text(body.utm_source),
        text(body.utm_medium),
        text(body.utm_campaign),
        text(body.utm_term),
        text(body.utm_content),
        text(body.referrer) || meta.referrer,
        meta.user_agent,
        meta.ip_address,
        "new",
        JSON.stringify(body)
      )
      .run();

    const leadId = Number(leadResult.meta.last_row_id);

    await env.DB.prepare(`
      INSERT INTO submissions (
        campaign_id,
        page_id,
        form_id,
        lead_id,
        submission_type,
        status,
        raw_payload
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(
        campaign?.id || null,
        page?.id || null,
        form?.id || null,
        leadId,
        "lead_magnet",
        "received",
        JSON.stringify(body)
      )
      .run();

    await createEvent(env, leadId, "lead_magnet_requested", {
      campaign_key: campaignKey,
      page_key: pageKey,
      form_key: formKey,
      source,
      email,
      title,
      download_url: downloadUrl
    });

    const emailResult = await sendLeadMagnetEmail(env, email, {
      title,
      description: description || undefined,
      downloadUrl
    });

    await createEvent(env, leadId, "lead_magnet_email_delivery", {
      sent: emailResult.sent,
      title,
      download_url: downloadUrl,
      reason: emailResult.sent ? null : emailResult.reason
    });

    return json(
      {
        success: true,
        message: emailResult.sent
          ? "Lead captured and download email sent successfully."
          : "Lead captured. Email delivery is not configured or failed.",
        lead_id: leadId,
        email_sent: emailResult.sent,
        download_url: emailResult.sent ? undefined : downloadUrl,
        email_error: emailResult.sent ? undefined : emailResult.reason
      },
      201
    );
  }

  if (request.method === "GET" && url.pathname === "/api/campaigns") {
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

    return json({ success: true, campaigns: campaigns.results });
  }

  if (request.method === "POST" && url.pathname === "/api/campaigns") {
    const body = await readJson(request);

    const campaignKey = text(body.campaign_key) || slugify(text(body.name) || "");
    const name = text(body.name);
    const description = text(body.description);
    const status = text(body.status) || "active";

    if (!campaignKey || !name) {
      return json({ success: false, error: "campaign_key and name are required" }, 400);
    }

    const existing = await getCampaignByKey(env, campaignKey);
    if (existing) return json({ success: false, error: "Campaign already exists" }, 409);

    const result = await env.DB.prepare(`
      INSERT INTO campaigns (
        campaign_key,
        name,
        description,
        status
      ) VALUES (?, ?, ?, ?)
    `)
      .bind(campaignKey, name, description, status)
      .run();

    return json(
      {
        success: true,
        message: "Campaign created successfully",
        campaign: {
          id: result.meta.last_row_id,
          campaign_key: campaignKey,
          name,
          description,
          status
        }
      },
      201
    );
  }

  if (request.method === "GET" && url.pathname === "/api/pages") {
    const campaignKey = url.searchParams.get("campaign_key");
    const status = url.searchParams.get("status");

    const where: string[] = [];
    const values: any[] = [];

    if (campaignKey) {
      where.push("campaigns.campaign_key = ?");
      values.push(campaignKey);
    }

    if (status) {
      where.push("pages.status = ?");
      values.push(status);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const pages = await env.DB.prepare(`
      SELECT
        pages.id,
        pages.page_key,
        pages.slug,
        pages.title,
        pages.page_type,
        pages.status,
        pages.created_at,
        pages.updated_at,
        campaigns.name AS campaign_name,
        campaigns.campaign_key,
        COUNT(leads.id) AS lead_count
      FROM pages
      LEFT JOIN campaigns ON campaigns.id = pages.campaign_id
      LEFT JOIN leads ON leads.page_id = pages.id
      ${whereSql}
      GROUP BY pages.id
      ORDER BY pages.created_at DESC
    `)
      .bind(...values)
      .all();

    return json({ success: true, pages: pages.results });
  }

  if (request.method === "POST" && url.pathname === "/api/pages") {
    const body = await readJson(request);

    const campaignKey = text(body.campaign_key);
    const pageKey = text(body.page_key) || slugify(text(body.title) || "");
    const slug = text(body.slug) || pageKey;
    const title = text(body.title);
    const pageType = text(body.page_type) || "landing_page";
    const status = text(body.status) || "published";

    if (!pageKey || !slug || !title) {
      return json({ success: false, error: "page_key, slug, and title are required" }, 400);
    }

    const existingPage = await getPageBySlug(env, slug);
    if (existingPage) {
      return json({ success: false, error: "A page with this slug or page_key already exists" }, 409);
    }

    const campaign = campaignKey ? await ensureCampaign(env, campaignKey) : null;

    const result = await env.DB.prepare(`
      INSERT INTO pages (
        campaign_id,
        page_key,
        slug,
        title,
        page_type,
        status
      ) VALUES (?, ?, ?, ?, ?, ?)
    `)
      .bind(campaign?.id || null, pageKey, slug, title, pageType, status)
      .run();

    return json(
      {
        success: true,
        message: "Page created successfully",
        page: {
          id: result.meta.last_row_id,
          page_key: pageKey,
          slug,
          title,
          page_type: pageType,
          status,
          campaign_key: campaignKey
        }
      },
      201
    );
  }

  const pageMatch = url.pathname.match(/^\/api\/pages\/([^/]+)$/);

  if (pageMatch && request.method === "GET") {
    const slug = decodeURIComponent(pageMatch[1]);
    const page = await getPageBySlug(env, slug);

    if (!page) return json({ success: false, error: "Page not found" }, 404);

    const form = await env.DB.prepare(`
      SELECT
        id,
        form_key,
        name,
        form_type,
        status
      FROM forms
      WHERE page_id = ?
      ORDER BY id ASC
      LIMIT 1
    `)
      .bind(page.id)
      .first<any>();

    return json({
      success: true,
      page: {
        ...page,
        form_key: form?.form_key || null,
        form_name: form?.name || null,
        form_type: form?.form_type || null
      }
    });
  }

  if (pageMatch && request.method === "PATCH") {
    const slug = decodeURIComponent(pageMatch[1]);
    const body = await readJson(request);
    const existingPage = await getPageBySlug(env, slug);

    if (!existingPage) return json({ success: false, error: "Page not found" }, 404);

    const campaignKey = text(body.campaign_key);
    const campaign = campaignKey ? await ensureCampaign(env, campaignKey) : null;

    const newPageKey = text(body.page_key) || String(existingPage.page_key);
    const newSlug = text(body.slug) || String(existingPage.slug);
    const newTitle = text(body.title) || String(existingPage.title);
    const newPageType = text(body.page_type) || String(existingPage.page_type || "landing_page");
    const newStatus = text(body.status) || String(existingPage.status || "published");

    await env.DB.prepare(`
      UPDATE pages
      SET
        campaign_id = ?,
        page_key = ?,
        slug = ?,
        title = ?,
        page_type = ?,
        status = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
      .bind(
        campaign?.id || existingPage.campaign_id || null,
        newPageKey,
        newSlug,
        newTitle,
        newPageType,
        newStatus,
        existingPage.id
      )
      .run();

    return json({ success: true, message: "Page updated successfully" });
  }

  if (pageMatch && request.method === "DELETE") {
    const slug = decodeURIComponent(pageMatch[1]);
    const existingPage = await getPageBySlug(env, slug);

    if (!existingPage) return json({ success: false, error: "Page not found" }, 404);

    await env.DB.prepare(`
      UPDATE pages
      SET status = 'archived', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
      .bind(existingPage.id)
      .run();

    return json({ success: true, message: "Page archived successfully" });
  }

  if (request.method === "GET" && url.pathname === "/api/forms") {
    const forms = await env.DB.prepare(`
      SELECT
        forms.id,
        forms.form_key,
        forms.name,
        forms.form_type,
        forms.status,
        forms.created_at,
        campaigns.name AS campaign_name,
        pages.title AS page_title
      FROM forms
      LEFT JOIN campaigns ON campaigns.id = forms.campaign_id
      LEFT JOIN pages ON pages.id = forms.page_id
      ORDER BY forms.created_at DESC
    `).all();

    return json({ success: true, forms: forms.results });
  }

  if (request.method === "POST" && url.pathname === "/api/forms") {
    const body = await readJson(request);

    const campaignKey = text(body.campaign_key);
    const pageKey = text(body.page_key);
    const formKey = text(body.form_key) || slugify(text(body.name) || "");
    const name = text(body.name);
    const formType = text(body.form_type) || "lead_capture";
    const status = text(body.status) || "active";

    if (!formKey || !name) {
      return json({ success: false, error: "form_key and name are required" }, 400);
    }

    const campaign = campaignKey ? await getCampaignByKey(env, campaignKey) : null;
    const page = pageKey ? await getPageByKey(env, pageKey) : null;

    const result = await env.DB.prepare(`
      INSERT INTO forms (
        campaign_id,
        page_id,
        form_key,
        name,
        form_type,
        status
      ) VALUES (?, ?, ?, ?, ?, ?)
    `)
      .bind(campaign?.id || null, page?.id || null, formKey, name, formType, status)
      .run();

    return json(
      {
        success: true,
        message: "Form created successfully",
        form: {
          id: result.meta.last_row_id,
          form_key: formKey,
          name,
          form_type: formType,
          status
        }
      },
      201
    );
  }

  if (request.method === "GET" && url.pathname === "/api/leads") {
    const campaignKey = url.searchParams.get("campaign_key");
    const status = url.searchParams.get("status");

    const where: string[] = [];
    const values: any[] = [];

    if (campaignKey) {
      where.push("campaigns.campaign_key = ?");
      values.push(campaignKey);
    }

    if (status) {
      where.push("leads.status = ?");
      values.push(status);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const leads = await env.DB.prepare(`
      SELECT
        leads.id,
        leads.full_name,
        leads.email,
        leads.phone,
        leads.company,
        leads.message,
        leads.source,
        leads.utm_source,
        leads.utm_medium,
        leads.utm_campaign,
        leads.status,
        leads.created_at,
        campaigns.name AS campaign_name,
        campaigns.campaign_key,
        pages.title AS page_title,
        pages.page_key,
        forms.name AS form_name,
        forms.form_key
      FROM leads
      LEFT JOIN campaigns ON campaigns.id = leads.campaign_id
      LEFT JOIN pages ON pages.id = leads.page_id
      LEFT JOIN forms ON forms.id = leads.form_id
      ${whereSql}
      ORDER BY leads.created_at DESC
      LIMIT 250
    `)
      .bind(...values)
      .all();

    return json({ success: true, leads: leads.results });
  }

  if (request.method === "POST" && url.pathname === "/api/leads") {
    const body = await readJson(request);
    const meta = getClientMeta(request);

    const campaignKey = text(body.campaign_key);
    const pageKey = text(body.page_key);
    const formKey = text(body.form_key);

    const fullName = text(body.full_name);
    const email = text(body.email);
    const phone = text(body.phone);
    const company = text(body.company);
    const message = text(body.message);
    const source = text(body.source) || "website";

    if (!email && !phone) {
      return json({ success: false, error: "Email or phone is required" }, 400);
    }

    let campaign = campaignKey ? await getCampaignByKey(env, campaignKey) : null;
    if (!campaign && campaignKey) campaign = await ensureCampaign(env, campaignKey);

    const page = pageKey ? await getPageByKey(env, pageKey) : null;
    const form = formKey ? await getFormByKey(env, formKey) : null;

    const result = await env.DB.prepare(`
      INSERT INTO leads (
        campaign_id,
        page_id,
        form_id,
        full_name,
        email,
        phone,
        company,
        message,
        source,
        utm_source,
        utm_medium,
        utm_campaign,
        utm_term,
        utm_content,
        referrer,
        user_agent,
        ip_address,
        status,
        raw_payload
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(
        campaign?.id || null,
        page?.id || null,
        form?.id || null,
        fullName,
        email,
        phone,
        company,
        message,
        source,
        text(body.utm_source),
        text(body.utm_medium),
        text(body.utm_campaign),
        text(body.utm_term),
        text(body.utm_content),
        text(body.referrer) || meta.referrer,
        meta.user_agent,
        meta.ip_address,
        "new",
        JSON.stringify(body)
      )
      .run();

    const leadId = Number(result.meta.last_row_id);

    await env.DB.prepare(`
      INSERT INTO submissions (
        campaign_id,
        page_id,
        form_id,
        lead_id,
        submission_type,
        status,
        raw_payload
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(
        campaign?.id || null,
        page?.id || null,
        form?.id || null,
        leadId,
        text(body.submission_type) || "lead",
        "received",
        JSON.stringify(body)
      )
      .run();

    await createEvent(env, leadId, "lead_created", {
      campaign_key: campaignKey,
      page_key: pageKey,
      form_key: formKey,
      source,
      email,
      phone
    });

    return json({ success: true, message: "Lead captured successfully", lead_id: leadId }, 201);
  }

  const leadMatch = url.pathname.match(/^\/api\/leads\/(\d+)$/);

  if (leadMatch && request.method === "GET") {
    const leadId = Number(leadMatch[1]);

    const lead = await env.DB.prepare(`
      SELECT
        leads.*,
        campaigns.name AS campaign_name,
        campaigns.campaign_key,
        pages.title AS page_title,
        pages.page_key,
        forms.name AS form_name,
        forms.form_key
      FROM leads
      LEFT JOIN campaigns ON campaigns.id = leads.campaign_id
      LEFT JOIN pages ON pages.id = leads.page_id
      LEFT JOIN forms ON forms.id = leads.form_id
      WHERE leads.id = ?
    `)
      .bind(leadId)
      .first();

    if (!lead) return json({ success: false, error: "Lead not found" }, 404);
    return json({ success: true, lead });
  }

  if (leadMatch && request.method === "PATCH") {
    const leadId = Number(leadMatch[1]);
    const body = await readJson(request);
    const status = text(body.status);

    if (!status) return json({ success: false, error: "status is required" }, 400);

    await env.DB.prepare(`
      UPDATE leads
      SET status = ?
      WHERE id = ?
    `)
      .bind(status, leadId)
      .run();

    await createEvent(env, leadId, "lead_status_updated", { status });

    return json({ success: true, message: "Lead updated successfully" });
  }

  if (request.method === "GET" && url.pathname === "/api/dashboard") {
    const totals = await env.DB.prepare(`
      SELECT
        COUNT(*) AS total_leads,
        SUM(CASE WHEN date(created_at) = date('now') THEN 1 ELSE 0 END) AS todays_leads,
        SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) AS new_leads
      FROM leads
    `).first();

    const campaigns = await env.DB.prepare(`
      SELECT
        campaigns.id,
        campaigns.campaign_key,
        campaigns.name,
        campaigns.status,
        COUNT(leads.id) AS lead_count
      FROM campaigns
      LEFT JOIN leads ON leads.campaign_id = campaigns.id
      GROUP BY campaigns.id
      ORDER BY campaigns.created_at DESC
      LIMIT 20
    `).all();

    const recentLeads = await env.DB.prepare(`
      SELECT
        leads.id,
        leads.full_name,
        leads.email,
        leads.phone,
        leads.source,
        leads.status,
        leads.created_at,
        campaigns.name AS campaign_name
      FROM leads
      LEFT JOIN campaigns ON campaigns.id = leads.campaign_id
      ORDER BY leads.created_at DESC
      LIMIT 20
    `).all();

    return json({
      success: true,
      totals,
      campaigns: campaigns.results,
      recent_leads: recentLeads.results
    });
  }

  return null;
}
