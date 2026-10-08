import { Announcement, AnnouncementSeverity, AnnouncementsPayload, Env } from "./types";
import seedData from "../announcements.json";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function isSafeHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && !u.username && !u.password;
  } catch {
    return false;
  }
}

export async function timingSafeEqualString(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const aBuf = enc.encode(a);
  const bBuf = enc.encode(b);
  if (aBuf.byteLength !== bBuf.byteLength) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < aBuf.byteLength; i++) {
    diff |= aBuf[i] ^ bBuf[i];
  }
  return diff === 0;
}

export async function computeEtag(text: string): Promise<string> {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(text));
  const hex = Array.from(new Uint8Array(digest))
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `"${hex}"`;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  announcements?: Announcement[];
}

export function validatePayload(data: unknown): ValidationResult {
  const errors: string[] = [];
  if (!data || typeof data !== "object") {
    return { valid: false, errors: ["Payload must be a JSON object"] };
  }

  const payload = data as Record<string, unknown>;
  if (!Array.isArray(payload.announcements)) {
    return { valid: false, errors: ["Field 'announcements' must be an array"] };
  }

  const seenIds = new Set<string>();
  const parsedAnnouncements: Announcement[] = [];

  for (let i = 0; i < payload.announcements.length; i++) {
    const item = payload.announcements[i];
    const prefix = `Announcement[${i}]`;

    if (!item || typeof item !== "object") {
      errors.push(`${prefix}: must be an object`);
      continue;
    }

    const rec = item as Record<string, unknown>;

    // id
    if (typeof rec.id !== "string" || rec.id.trim().length === 0) {
      errors.push(`${prefix}: 'id' must be a non-empty string`);
    } else if (seenIds.has(rec.id)) {
      errors.push(`${prefix}: duplicate 'id' "${rec.id}"`);
    } else {
      seenIds.add(rec.id);
    }

    // severity
    if (rec.severity !== "info" && rec.severity !== "warning" && rec.severity !== "critical") {
      errors.push(`${prefix}: 'severity' must be one of 'info', 'warning', 'critical'`);
    }

    // title
    if (typeof rec.title !== "string" || rec.title.trim().length === 0) {
      errors.push(`${prefix}: 'title' must be a non-empty string`);
    }

    // body
    if (typeof rec.body !== "string") {
      errors.push(`${prefix}: 'body' must be a string`);
    }

    // publishedAt
    if (typeof rec.publishedAt !== "string" || isNaN(Date.parse(rec.publishedAt))) {
      errors.push(`${prefix}: 'publishedAt' must be a valid ISO 8601 date string`);
    }

    // expiresAt
    if (rec.expiresAt !== undefined && rec.expiresAt !== null) {
      if (typeof rec.expiresAt !== "string" || isNaN(Date.parse(rec.expiresAt))) {
        errors.push(`${prefix}: 'expiresAt' must be null or a valid ISO 8601 date string`);
      } else if (typeof rec.publishedAt === "string" && !isNaN(Date.parse(rec.publishedAt))) {
        if (Date.parse(rec.expiresAt) <= Date.parse(rec.publishedAt)) {
          errors.push(`${prefix}: 'expiresAt' must be after 'publishedAt'`);
        }
      }
    }

    // Check link fields - reject multiple links
    if (Array.isArray(rec.links) || (rec.links && typeof rec.links === "object")) {
      errors.push(`${prefix}: multiple links are not permitted (use single 'link' field)`);
    }

    if (rec.link !== undefined && rec.link !== null) {
      if (typeof rec.link !== "string" || !isSafeHttpUrl(rec.link)) {
        errors.push(`${prefix}: 'link' must be a valid https:// URL without credentials`);
      }
    }

    // linkLabel
    if (rec.linkLabel !== undefined && rec.linkLabel !== null && typeof rec.linkLabel !== "string") {
      errors.push(`${prefix}: 'linkLabel' must be a string`);
    }

    if (errors.length === 0) {
      parsedAnnouncements.push({
        id: rec.id as string,
        severity: rec.severity as AnnouncementSeverity,
        title: rec.title as string,
        body: (rec.body as string) || "",
        ...(rec.link ? { link: rec.link as string } : {}),
        ...(rec.linkLabel ? { linkLabel: rec.linkLabel as string } : {}),
        publishedAt: rec.publishedAt as string,
        expiresAt: (rec.expiresAt as string | null) ?? null,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    announcements: errors.length === 0 ? parsedAnnouncements : undefined,
  };
}

export function filterActiveAnnouncements(
  announcements: Announcement[],
  nowMs = Date.now()
): Announcement[] {
  return announcements.filter((item) => {
    // Schedule check: publishedAt must be in the past or present
    const publishedMs = Date.parse(item.publishedAt);
    if (!isNaN(publishedMs) && publishedMs > nowMs) {
      return false;
    }

    // Expiration check: expiresAt must not be in the past
    if (item.expiresAt) {
      const expiresMs = Date.parse(item.expiresAt);
      if (!isNaN(expiresMs) && expiresMs <= nowMs) {
        return false;
      }
    }

    return true;
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Handle OPTIONS CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          ...CORS_HEADERS,
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    // Routing
    if (url.pathname === "/api/announcements") {
      if (request.method === "GET") {
        return handleGet(request, env);
      }
      if (request.method === "POST") {
        return handlePost(request, env);
      }
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Health / root check
    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response(
        JSON.stringify({
          status: "ok",
          service: "theorem-announcements",
          timestamp: new Date().toISOString(),
        }),
        {
          status: 200,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  },
};

async function handleGet(request: Request, env: Env): Promise<Response> {
  let payload: AnnouncementsPayload | null = null;

  // 1. Try reading from KV
  if (env.ANNOUNCEMENTS_KV) {
    try {
      const raw = await env.ANNOUNCEMENTS_KV.get("announcements");
      if (raw) {
        payload = JSON.parse(raw) as AnnouncementsPayload;
      }
    } catch {
      // Fallback to static seed on KV read failure
    }
  }

  // 2. Fall back to bundled seed if KV is empty
  if (!payload || !Array.isArray(payload.announcements)) {
    payload = seedData as AnnouncementsPayload;
  }

  // 3. Filter expired and future scheduled entries
  const active = filterActiveAnnouncements(payload.announcements, Date.now());
  const responseData = {
    announcements: active,
    updatedAt: payload.updatedAt || new Date().toISOString(),
  };

  const bodyJson = JSON.stringify(responseData);
  const etag = await computeEtag(bodyJson);

  // ETag conditional check
  const ifNoneMatch = request.headers.get("If-None-Match");
  if (ifNoneMatch && ifNoneMatch === etag) {
    return new Response(null, {
      status: 304,
      headers: {
        ...CORS_HEADERS,
        ETag: etag,
        "Cache-Control": "public, max-age=300",
      },
    });
  }

  return new Response(bodyJson, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      ETag: etag,
    },
  });
}

async function handlePost(request: Request, env: Env): Promise<Response> {
  // Authentication check
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const token = authHeader.slice(7).trim();
  if (!env.ADMIN_TOKEN || !(await timingSafeEqualString(token, env.ADMIN_TOKEN))) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // Parse JSON body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // Validate payload
  const result = validatePayload(body);
  if (!result.valid || !result.announcements) {
    return new Response(
      JSON.stringify({
        error: "Validation failed",
        details: result.errors,
      }),
      {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      }
    );
  }

  const updatedAt = new Date().toISOString();
  const payloadToStore: AnnouncementsPayload = {
    announcements: result.announcements,
    updatedAt,
  };

  // Write to KV
  if (env.ANNOUNCEMENTS_KV) {
    await env.ANNOUNCEMENTS_KV.put("announcements", JSON.stringify(payloadToStore));
  }

  return new Response(
    JSON.stringify({
      success: true,
      count: result.announcements.length,
      updatedAt,
    }),
    {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    }
  );
}
