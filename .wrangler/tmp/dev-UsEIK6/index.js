var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker/index.ts
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };
}
__name(corsHeaders, "corsHeaders");
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders()
    }
  });
}
__name(json, "json");
function text(value) {
  if (value === void 0 || value === null) return null;
  const cleaned = String(value).trim();
  return cleaned.length ? cleaned : null;
}
__name(text, "text");
function slugify(value) {
  return value.toLowerCase().trim().replace(/['"]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
__name(slugify, "slugify");
async function readJson(request) {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return {};
    return body;
  } catch {
    return {};
  }
}
__name(readJson, "readJson");
function getClientMeta(request) {
  return {
    user_agent: request.headers.get("User-Agent") || "",
    ip_address: request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "",
    referrer: request.headers.get("Referer") || ""
  };
}
__name(getClientMeta, "getClientMeta");
async function getCampaignByKey(env, campaignKey) {
  if (!campaignKey) return null;
  return await env.DB.prepare(
    "SELECT id, campaign_key, name FROM campaigns WHERE campaign_key = ?"
  ).bind(campaignKey).first();
}
__name(getCampaignByKey, "getCampaignByKey");
async function getPageByKey(env, pageKey) {
  if (!pageKey) return null;
  return await env.DB.prepare(
    "SELECT id, page_key, title FROM pages WHERE page_key = ?"
  ).bind(pageKey).first();
}
__name(getPageByKey, "getPageByKey");
async function getFormByKey(env, formKey) {
  if (!formKey) return null;
  return await env.DB.prepare(
    "SELECT id, form_key, name FROM forms WHERE form_key = ?"
  ).bind(formKey).first();
}
__name(getFormByKey, "getFormByKey");
async function ensureCampaign(env, campaignKey, name) {
  const existing = await getCampaignByKey(env, campaignKey);
  if (existing) return existing;
  const result = await env.DB.prepare(`
    INSERT INTO campaigns (
      campaign_key,
      name,
      description,
      status
    ) VALUES (?, ?, ?, ?)
  `).bind(
    campaignKey,
    name || campaignKey.replace(/-/g, " "),
    "Auto-created campaign",
    "active"
  ).run();
  return {
    id: result.meta.last_row_id,
    campaign_key: campaignKey,
    name: name || campaignKey
  };
}
__name(ensureCampaign, "ensureCampaign");
async function createEvent(env, leadId, eventType, eventData) {
  await env.DB.prepare(`
    INSERT INTO events (
      lead_id,
      event_type,
      event_data
    ) VALUES (?, ?, ?)
  `).bind(
    leadId,
    eventType,
    JSON.stringify(eventData)
  ).run();
}
__name(createEvent, "createEvent");
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders()
      });
    }
    try {
      if (request.method === "GET" && url.pathname === "/") {
        return json({
          success: true,
          message: "Liwox Forms API is live",
          version: "0.3.0"
        });
      }
      if (request.method === "GET" && url.pathname === "/api/health") {
        return json({
          success: true,
          status: "ok",
          service: "liwox-forms-api",
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
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
        if (existing) {
          return json({ success: false, error: "Campaign already exists" }, 409);
        }
        const result = await env.DB.prepare(`
          INSERT INTO campaigns (campaign_key, name, description, status)
          VALUES (?, ?, ?, ?)
        `).bind(campaignKey, name, description, status).run();
        return json({
          success: true,
          message: "Campaign created successfully",
          campaign: {
            id: result.meta.last_row_id,
            campaign_key: campaignKey,
            name,
            description,
            status
          }
        }, 201);
      }
      if (request.method === "GET" && url.pathname === "/api/pages") {
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
            campaigns.campaign_key
          FROM pages
          LEFT JOIN campaigns ON campaigns.id = pages.campaign_id
          ORDER BY pages.created_at DESC
        `).all();
        return json({ success: true, pages: pages.results });
      }
      if (request.method === "POST" && url.pathname === "/api/pages") {
        const body = await readJson(request);
        const campaignKey = text(body.campaign_key);
        const pageKey = text(body.page_key) || slugify(text(body.title) || "");
        const slug = text(body.slug) || pageKey;
        const title = text(body.title);
        const pageType = text(body.page_type) || "landing_page";
        const status = text(body.status) || "draft";
        if (!pageKey || !slug || !title) {
          return json({ success: false, error: "page_key, slug, and title are required" }, 400);
        }
        const campaign = campaignKey ? await getCampaignByKey(env, campaignKey) : null;
        const result = await env.DB.prepare(`
          INSERT INTO pages (campaign_id, page_key, slug, title, page_type, status)
          VALUES (?, ?, ?, ?, ?, ?)
        `).bind(campaign?.id || null, pageKey, slug, title, pageType, status).run();
        return json({
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
        }, 201);
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
          INSERT INTO forms (campaign_id, page_id, form_key, name, form_type, status)
          VALUES (?, ?, ?, ?, ?, ?)
        `).bind(campaign?.id || null, page?.id || null, formKey, name, formType, status).run();
        return json({
          success: true,
          message: "Form created successfully",
          form: {
            id: result.meta.last_row_id,
            form_key: formKey,
            name,
            form_type: formType,
            status
          }
        }, 201);
      }
      if (request.method === "GET" && url.pathname === "/api/leads") {
        const campaignKey = url.searchParams.get("campaign_key");
        const status = url.searchParams.get("status");
        const where = [];
        const values = [];
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
        `).bind(...values).all();
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
            campaign_id, page_id, form_id, full_name, email, phone, company,
            message, source, utm_source, utm_medium, utm_campaign, utm_term,
            utm_content, referrer, user_agent, ip_address, status, raw_payload
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
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
        ).run();
        const leadId = Number(result.meta.last_row_id);
        await env.DB.prepare(`
          INSERT INTO submissions (
            campaign_id, page_id, form_id, lead_id, submission_type, status, raw_payload
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(
          campaign?.id || null,
          page?.id || null,
          form?.id || null,
          leadId,
          text(body.submission_type) || "lead",
          "received",
          JSON.stringify(body)
        ).run();
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
        `).bind(leadId).first();
        if (!lead) return json({ success: false, error: "Lead not found" }, 404);
        return json({ success: true, lead });
      }
      if (leadMatch && request.method === "PATCH") {
        const leadId = Number(leadMatch[1]);
        const body = await readJson(request);
        const status = text(body.status);
        if (!status) return json({ success: false, error: "status is required" }, 400);
        await env.DB.prepare("UPDATE leads SET status = ? WHERE id = ?").bind(status, leadId).run();
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
      return json({ success: false, error: "Route not found", path: url.pathname }, 404);
    } catch (error) {
      return json({ success: false, error: error?.message || "Server error" }, 500);
    }
  }
};

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-NIdoaf/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-NIdoaf/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
