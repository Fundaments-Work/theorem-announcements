export type AnnouncementSeverity = "info" | "warning" | "critical";

export interface Announcement {
  id: string;
  severity: AnnouncementSeverity;
  title: string;
  body: string;
  link?: string;
  linkLabel?: string;
  publishedAt: string;
  expiresAt?: string | null;
}

export interface AnnouncementsPayload {
  announcements: Announcement[];
  updatedAt?: string;
}

export interface Env {
  ANNOUNCEMENTS_KV?: KVNamespace;
  ADMIN_TOKEN?: string;
}
