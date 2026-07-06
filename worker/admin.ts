/// <reference types="@cloudflare/workers-types" />

import { handleAuthRoutes } from "./auth";
import { handleAdminRoutes } from "./admin";
import { handleApiRoutes } from "./api";
import { corsHeaders, json } from "./utils";

export type Env = {
  DB: D1Database;
  RESEND_API_KEY?: string;
  ADMIN_EMAIL_FROM?: string;
  ADMIN_BASE_URL?: string;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders()
      });
    }

    try {
      const authResponse = await handleAuthRoutes(request, env);
      if (authResponse) return authResponse;

      const adminResponse = await handleAdminRoutes(request, env);
      if (adminResponse) return adminResponse;

      const apiResponse = await handleApiRoutes(request, env);
      if (apiResponse) return apiResponse;

      if (request.method === "GET" && url.pathname === "/") {
        return json({
          success: true,
          message: "Liwox Forms API is live",
          version: "0.5.0"
        });
      }

      return json(
        {
          success: false,
          error: "Route not found",
          path: url.pathname
        },
        404
      );
    } catch (error: any) {
      return json(
        {
          success: false,
          error: error?.message || "Server error"
        },
        500
      );
    }
  }
};