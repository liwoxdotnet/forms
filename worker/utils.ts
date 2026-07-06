/// <reference types="@cloudflare/workers-types" />

export function corsHeaders() {
    return {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    };
  }
  
  export function json(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders()
      }
    });
  }
  
  export async function readJson(request: Request) {
    try {
      const body = await request.json();
      if (!body || typeof body !== "object" || Array.isArray(body)) return {};
      return body as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  
  export function text(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    const cleaned = String(value).trim();
    return cleaned.length ? cleaned : null;
  }
  
  export function randomToken() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  
  export function addMinutes(minutes: number) {
    return new Date(Date.now() + minutes * 60 * 1000).toISOString();
  }