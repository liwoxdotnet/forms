type Env = {
    DB: D1Database;
  };
  
  function json(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization"
      }
    });
  }
  
  function getClientMeta(request: Request) {
    return {
      user_agent: request.headers.get("User-Agent") || "",
      ip_address:
        request.headers.get("CF-Connecting-IP") ||
        request.headers.get("X-Forwarded-For") ||
        ""
    };
  }
  
  export default {
    async fetch(request: Request, env: Env) {
      const url = new URL(request.url);
  
      if (request.method === "OPTIONS") {
        return json({ ok: true });
      }
  
      try {
        if (request.method === "GET" && url.pathname === "/") {
          return json({
            success: true,
            message: "Liwox Forms API is live"
          });
        }
  
        if (request.method === "POST" && url.pathname === "/api/leads") {
          const body: any = await request.json();
          const meta = getClientMeta(request);
  
          const {
            campaign_key,
            page_key,
            form_key,
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
            referrer
          } = body;
  
          if (!email && !phone) {
            return json({
              success: false,
              error: "Email or phone is required"
            }, 400);
          }
  
          let campaign = null;
          let page = null;
          let form = null;
  
          if (campaign_key) {
            campaign = await env.DB.prepare(
              "SELECT id FROM campaigns WHERE campaign_key = ?"
            ).bind(campaign_key).first();
          }
  
          if (page_key) {
            page = await env.DB.prepare(
              "SELECT id FROM pages WHERE page_key = ?"
            ).bind(page_key).first();
          }
  
          if (form_key) {
            form = await env.DB.prepare(
              "SELECT id FROM forms WHERE form_key = ?"
            ).bind(form_key).first();
          }
  
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
              raw_payload
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            campaign?.id || null,
            page?.id || null,
            form?.id || null,
            full_name || null,
            email || null,
            phone || null,
            company || null,
            message || null,
            source || null,
            utm_source || null,
            utm_medium || null,
            utm_campaign || null,
            utm_term || null,
            utm_content || null,
            referrer || null,
            meta.user_agent,
            meta.ip_address,
            JSON.stringify(body)
          ).run();
  
          const leadId = leadResult.meta.last_row_id;
  
          await env.DB.prepare(`
            INSERT INTO submissions (
              campaign_id,
              page_id,
              form_id,
              lead_id,
              submission_type,
              raw_payload
            ) VALUES (?, ?, ?, ?, ?, ?)
          `).bind(
            campaign?.id || null,
            page?.id || null,
            form?.id || null,
            leadId,
            "lead",
            JSON.stringify(body)
          ).run();
  
          await env.DB.prepare(`
            INSERT INTO events (
              lead_id,
              event_type,
              event_data
            ) VALUES (?, ?, ?)
          `).bind(
            leadId,
            "lead_created",
            JSON.stringify({
              source: source || null,
              page_key: page_key || null,
              form_key: form_key || null
            })
          ).run();
  
          return json({
            success: true,
            message: "Lead captured successfully",
            lead_id: leadId
          }, 201);
        }
  
        if (request.method === "GET" && url.pathname === "/api/leads") {
          const leads = await env.DB.prepare(`
            SELECT
              leads.id,
              leads.full_name,
              leads.email,
              leads.phone,
              leads.company,
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
            LIMIT 100
          `).all();
  
          return json({
            success: true,
            leads: leads.results
          });
        }
  
        return json({
          success: false,
          error: "Route not found"
        }, 404);
  
      } catch (error: any) {
        return json({
          success: false,
          error: error.message || "Server error"
        }, 500);
      }
    }
  };