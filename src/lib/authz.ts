import { ForbiddenError } from "./errors";

export const ROLES = ["owner", "admin", "member", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export type Permission =
  | "org:read"
  | "org:update"
  | "members:read"
  | "members:manage"
  | "shipments:read"
  | "shipments:write"
  | "documents:read"
  | "documents:upload"
  | "documents:edit_fields"
  | "documents:approve"
  | "document_types:manage"
  | "tasks:write"
  | "audit:read"
  | "integrations:read";

const READ: Permission[] = ["org:read", "members:read", "shipments:read", "documents:read", "integrations:read"];
const MEMBER: Permission[] = [...READ, "shipments:write", "documents:upload", "documents:edit_fields", "tasks:write"];
const ADMIN: Permission[] = [...MEMBER, "org:update", "members:manage", "documents:approve", "document_types:manage", "audit:read"];

const MATRIX: Record<Role, ReadonlySet<Permission>> = {
  owner: new Set(ADMIN),
  admin: new Set(ADMIN),
  member: new Set(MEMBER),
  viewer: new Set(READ),
};

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role]?.has(permission) ?? false;
}

export function assertCan(role: Role, permission: Permission): void {
  if (!can(role, permission)) throw new ForbiddenError();
}

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  viewer: "Viewer",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: "Full access, including managing admins and owners.",
  admin: "Manage members, settings, approvals and the audit log.",
  member: "Create shipments, upload documents and edit extracted values.",
  viewer: "Read-only access to shipments and documents.",
};
