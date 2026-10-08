import { describe, it, expect, vi } from "vitest";
import worker, {
  isSafeHttpUrl,
  timingSafeEqualString,
  validatePayload,
  filterActiveAnnouncements,
  computeEtag,
} from "../src/index";
import { Announcement, Env } from "../src/types";

describe("Announcements Worker", () => {
  describe("isSafeHttpUrl", () => {
    it("accepts valid https URLs", () => {
      expect(isSafeHttpUrl("https://github.com/Fundaments-Work/Theorem")).toBe(true);
      expect(isSafeHttpUrl("https://buymemomo.com/usefundaments")).toBe(true);
      expect(isSafeHttpUrl("https://example.com/path?query=1#hash")).toBe(true);
    });

    it("rejects non-https schemes", () => {
      expect(isSafeHttpUrl("http://insecure.com")).toBe(false);
      expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false);
      expect(isSafeHttpUrl("data:text/html;base64,PHNjcmlwdD4=")).toBe(false);
      expect(isSafeHttpUrl("ftp://files.example.com")).toBe(false);
    });

    it("rejects credentialed URLs", () => {
      expect(isSafeHttpUrl("https://user:pass@example.com/path")).toBe(false);
      expect(isSafeHttpUrl("https://admin@example.com")).toBe(false);
    });

    it("rejects malformed strings", () => {
      expect(isSafeHttpUrl("")).toBe(false);
      expect(isSafeHttpUrl("not-a-url")).toBe(false);
      expect(isSafeHttpUrl("https://")).toBe(false);
    });
  });

  describe("timingSafeEqualString", () => {
    it("returns true for matching strings", async () => {
      expect(await timingSafeEqualString("secret-token-123", "secret-token-123")).toBe(true);
    });

    it("returns false for non-matching strings of same length", async () => {
      expect(await timingSafeEqualString("secret-token-123", "secret-token-999")).toBe(false);
    });

    it("returns false for strings of different length", async () => {
      expect(await timingSafeEqualString("short", "much-longer-string")).toBe(false);
      expect(await timingSafeEqualString("", "token")).toBe(false);
    });
  });

  describe("validatePayload", () => {
    const validAnnouncement: Announcement = {
      id: "ann-1",
      severity: "info",
      title: "Title 1",
      body: "Body message with https://theorem.fundaments.work link.",
      link: "https://theorem.fundaments.work",
      linkLabel: "Website",
      publishedAt: "2026-10-01T00:00:00Z",
      expiresAt: "2026-10-15T00:00:00Z",
    };

    it("validates a fully compliant payload", () => {
      const res = validatePayload({ announcements: [validAnnouncement] });
      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
      expect(res.announcements).toHaveLength(1);
    });

    it("rejects non-object or non-array payloads", () => {
      expect(validatePayload(null).valid).toBe(false);
      expect(validatePayload("string").valid).toBe(false);
      expect(validatePayload({ announcements: "not-an-array" }).valid).toBe(false);
    });

    it("rejects empty id or duplicate ids", () => {
      const resEmpty = validatePayload({
        announcements: [{ ...validAnnouncement, id: "" }],
      });
      expect(resEmpty.valid).toBe(false);
      expect(resEmpty.errors[0]).toContain("'id' must be a non-empty string");

      const resDup = validatePayload({
        announcements: [validAnnouncement, { ...validAnnouncement, title: "Title 2" }],
      });
      expect(resDup.valid).toBe(false);
      expect(resDup.errors[0]).toContain("duplicate 'id'");
    });

    it("rejects invalid severity values", () => {
      const res = validatePayload({
        announcements: [{ ...validAnnouncement, severity: "urgent" as any }],
      });
      expect(res.valid).toBe(false);
      expect(res.errors[0]).toContain("'severity' must be one of");
    });

    it("rejects unsafe or non-https links", () => {
      const res = validatePayload({
        announcements: [{ ...validAnnouncement, link: "http://insecure.com" }],
      });
      expect(res.valid).toBe(false);
      expect(res.errors[0]).toContain("'link' must be a valid https:// URL");
    });

    it("rejects multiple link fields", () => {
      const res = validatePayload({
        announcements: [
          {
            ...validAnnouncement,
            links: ["https://example.com/1", "https://example.com/2"],
          },
        ],
      });
      expect(res.valid).toBe(false);
      expect(res.errors[0]).toContain("multiple links are not permitted");
    });

    it("rejects expiresAt prior to publishedAt", () => {
      const res = validatePayload({
        announcements: [
          {
            ...validAnnouncement,
            publishedAt: "2026-10-10T00:00:00Z",
            expiresAt: "2026-10-05T00:00:00Z",
          },
        ],
      });
      expect(res.valid).toBe(false);
      expect(res.errors[0]).toContain("'expiresAt' must be after 'publishedAt'");
    });
  });

  describe("filterActiveAnnouncements", () => {
    const now = Date.parse("2026-10-08T12:00:00Z");

    const activeItem: Announcement = {
      id: "active",
      severity: "info",
      title: "Active",
      body: "Text",
      publishedAt: "2026-10-01T00:00:00Z",
      expiresAt: "2026-10-20T00:00:00Z",
    };

    const futureItem: Announcement = {
      id: "future",
      severity: "info",
      title: "Future",
      body: "Text",
      publishedAt: "2026-10-15T00:00:00Z",
      expiresAt: null,
    };

    const expiredItem: Announcement = {
      id: "expired",
      severity: "critical",
      title: "Expired",
      body: "Text",
      publishedAt: "2026-09-01T00:00:00Z",
      expiresAt: "2026-10-05T00:00:00Z",
    };

    it("keeps current announcements and filters future or expired items", () => {
      const filtered = filterActiveAnnouncements(
        [activeItem, futureItem, expiredItem],
        now
      );
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe("active");
    });
  });

  describe("Worker HTTP endpoints", () => {
    function createMockEnv(initialData?: string, adminToken = "valid-token"): Env {
      const store = new Map<string, string>();
      if (initialData) {
        store.set("announcements", initialData);
      }
      return {
        ANNOUNCEMENTS_KV: {
          get: vi.fn(async (key: string) => store.get(key) || null),
          put: vi.fn(async (key: string, val: string) => {
            store.set(key, val);
          }),
        } as unknown as KVNamespace,
        ADMIN_TOKEN: adminToken,
      };
    }

    it("handles OPTIONS preflight with CORS headers", async () => {
      const req = new Request("https://announcements.fundaments.work/api/announcements", {
        method: "OPTIONS",
      });
      const res = await worker.fetch(req, {} as Env);
      expect(res.status).toBe(204);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
      expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
    });

    it("GET /api/announcements returns 200 with CORS and ETag", async () => {
      const env = createMockEnv();
      const req = new Request("https://announcements.fundaments.work/api/announcements", {
        method: "GET",
      });
      const res = await worker.fetch(req, env);
      expect(res.status).toBe(200);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
      expect(res.headers.get("ETag")).toBeTruthy();

      const body = (await res.json()) as any;
      expect(body.announcements).toBeInstanceOf(Array);
      expect(body.updatedAt).toBeTruthy();
    });

    it("GET /api/announcements returns 304 when ETag matches If-None-Match", async () => {
      const env = createMockEnv();
      const req1 = new Request("https://announcements.fundaments.work/api/announcements", {
        method: "GET",
      });
      const res1 = await worker.fetch(req1, env);
      const etag = res1.headers.get("ETag")!;

      const req2 = new Request("https://announcements.fundaments.work/api/announcements", {
        method: "GET",
        headers: { "If-None-Match": etag },
      });
      const res2 = await worker.fetch(req2, env);
      expect(res2.status).toBe(304);
    });

    it("POST /api/announcements returns 401 without valid Bearer token", async () => {
      const env = createMockEnv(undefined, "secret-pass");

      // No header
      const req1 = new Request("https://announcements.fundaments.work/api/announcements", {
        method: "POST",
        body: JSON.stringify({ announcements: [] }),
      });
      const res1 = await worker.fetch(req1, env);
      expect(res1.status).toBe(401);

      // Wrong token
      const req2 = new Request("https://announcements.fundaments.work/api/announcements", {
        method: "POST",
        headers: { Authorization: "Bearer wrong-pass" },
        body: JSON.stringify({ announcements: [] }),
      });
      const res2 = await worker.fetch(req2, env);
      expect(res2.status).toBe(401);
    });

    it("POST /api/announcements returns 400 for invalid payload", async () => {
      const env = createMockEnv(undefined, "secret-pass");
      const req = new Request("https://announcements.fundaments.work/api/announcements", {
        method: "POST",
        headers: {
          Authorization: "Bearer secret-pass",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          announcements: [
            {
              id: "bad-item",
              severity: "invalid-severity",
              title: "Test",
              body: "Body",
              publishedAt: "invalid-date",
            },
          ],
        }),
      });
      const res = await worker.fetch(req, env);
      expect(res.status).toBe(400);
      const json = (await res.json()) as any;
      expect(json.error).toBe("Validation failed");
      expect(json.details.length).toBeGreaterThan(0);
    });

    it("POST /api/announcements writes to KV on valid payload", async () => {
      const env = createMockEnv(undefined, "secret-pass");
      const newAnnouncement: Announcement = {
        id: "new-version-alert",
        severity: "critical",
        title: "Urgent Security Advisory",
        body: "Please update Theorem to version 1.6.0 immediately.",
        link: "https://github.com/Fundaments-Work/Theorem/releases",
        linkLabel: "Download Update",
        publishedAt: new Date().toISOString(),
        expiresAt: null,
      };

      const req = new Request("https://announcements.fundaments.work/api/announcements", {
        method: "POST",
        headers: {
          Authorization: "Bearer secret-pass",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ announcements: [newAnnouncement] }),
      });

      const res = await worker.fetch(req, env);
      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json.success).toBe(true);
      expect(json.count).toBe(1);

      // Verify that KV put was called
      expect(env.ANNOUNCEMENTS_KV!.put).toHaveBeenCalled();
    });

    it("GET returns 404 for unknown routes", async () => {
      const req = new Request("https://announcements.fundaments.work/unknown-route");
      const res = await worker.fetch(req, {} as Env);
      expect(res.status).toBe(404);
    });
  });
});
