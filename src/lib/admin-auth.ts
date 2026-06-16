import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";

const adminCookieName = "admin-token";

function getSecret() {
  const secret = process.env.AUTH_SECRET || "fallback-admin-secret";
  return new TextEncoder().encode(secret);
}

export async function createAdminToken(): Promise<string> {
  return new SignJWT({ role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .sign(getSecret());
}

export async function verifyAdminToken(token: string): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload.role === "admin";
  } catch {
    return false;
  }
}

export async function setAdminCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(adminCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
}

export async function getAdminTokenFromCookie(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get(adminCookieName)?.value;
}

export async function clearAdminCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(adminCookieName);
}

export async function isAdminAuthenticated(): Promise<boolean> {
  const token = await getAdminTokenFromCookie();
  if (!token) return false;
  return verifyAdminToken(token);
}

export async function verifyAdminRequest(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get(adminCookieName)?.value;
  if (!token) return false;
  return verifyAdminToken(token);
}
