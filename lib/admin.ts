export const ADMIN_EMAILS = ["sandeepgp.2397@gmail.com", "preetip701@gmail.com"] as const;
export const isAdminEmail = (email?: string | null) => !!email && ADMIN_EMAILS.includes(email.toLowerCase() as typeof ADMIN_EMAILS[number]);
