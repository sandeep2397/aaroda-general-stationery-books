import type { Db } from "mongodb";
import { ADMIN_EMAILS } from "@/lib/admin";

export const ROLES = { ADMIN: "Admin", CUSTOMER: "Customer" } as const;
export type UserRoleName = typeof ROLES[keyof typeof ROLES];

const ROLE_PERMISSIONS: Record<UserRoleName, string[]> = {
  Admin: ["inventory:read", "inventory:write", "inventory:delete", "orders:read", "orders:fulfill", "payments:read", "roles:read"],
  Customer: ["catalog:read", "orders:create", "orders:read:own", "addresses:manage"],
};

type RoleUser = { userId: string; email?: string; phoneNumber?: string };
const normalizedEmail = (email?: string) => email?.trim().toLowerCase() || "";

export async function seedLegacyAdminRoles(db: Db) {
  const now = new Date();
  const knownUsers = await db.collection("users").find({ email: { $in: [...ADMIN_EMAILS] } }, { projection: { userId: 1, email: 1 } }).toArray();
  const userIdByEmail = new Map(knownUsers.map((user) => [normalizedEmail(user.email), String(user.userId)]));
  await Promise.all(ADMIN_EMAILS.map((email) => db.collection("userRoles").updateOne(
    { email },
    {
      $set: { role: ROLES.ADMIN, permissions: ROLE_PERMISSIONS.Admin, active: true, updatedAt: now },
      $setOnInsert: { email, createdAt: now },
      ...(userIdByEmail.get(email) ? { $set: { role: ROLES.ADMIN, permissions: ROLE_PERMISSIONS.Admin, active: true, userId: userIdByEmail.get(email), updatedAt: now } } : {}),
    },
    { upsert: true },
  )));
}

export async function ensureUserRole(db: Db, user: RoleUser) {
  const email = normalizedEmail(user.email);
  const now = new Date();
  let role = await db.collection("userRoles").findOne({ $or: [{ userId: user.userId }, ...(email ? [{ email }] : [])] });
  if (!role) {
    const customerRole = { userId: user.userId, ...(email ? { email } : {}), ...(user.phoneNumber ? { phoneNumber: user.phoneNumber } : {}), role: ROLES.CUSTOMER, permissions: ROLE_PERMISSIONS.Customer, active: true, createdAt: now, updatedAt: now };
    await db.collection("userRoles").insertOne(customerRole);
    return customerRole;
  } else {
    await db.collection("userRoles").updateOne({ _id: role._id }, { $set: { userId: user.userId, ...(email ? { email } : {}), ...(user.phoneNumber ? { phoneNumber: user.phoneNumber } : {}), lastSeenAt: now, updatedAt: now } });
    role = { ...role, userId: user.userId, ...(email ? { email } : {}), ...(user.phoneNumber ? { phoneNumber: user.phoneNumber } : {}), lastSeenAt: now, updatedAt: now };
  }
  return {
    userId: user.userId,
    email: email || undefined,
    role: String(role.role) as UserRoleName,
    permissions: Array.isArray(role.permissions) ? role.permissions.map(String) : [],
    active: Boolean(role.active),
  };
}

export async function hasPermission(db: Db, user: RoleUser, permission: string) {
  const role = await ensureUserRole(db, user);
  return role.active && role.permissions.includes(permission);
}

export function rolePermissions(role: UserRoleName) { return ROLE_PERMISSIONS[role]; }
