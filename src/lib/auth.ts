import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { getUserByEmail, upsertOAuthUser } from "@/infra/db/repository";
import { getDb } from "@/infra/db/connection";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  providers: [
    Credentials({
      id: "credentials",
      name: "이메일 로그인",
      credentials: {
        email: { label: "이메일", type: "email" },
        password: { label: "비밀번호", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email as string;
        const password = credentials?.password as string;
        if (!email || !password) return null;

        const db = getDb();
        const user = getUserByEmail(db, email);
        if (!user) return null;

        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) return null;

        return { id: String(user.id), name: user.name, email: user.email };
      },
    }),
    {
      id: "hrms",
      name: "HRMS",
      type: "oauth",
      clientId: process.env.AUTH_HRMS_ID,
      clientSecret: process.env.AUTH_HRMS_SECRET,
      client: {
        token_endpoint_auth_method: "client_secret_post",
      },
      authorization: {
        url: `${process.env.AUTH_HRMS_ISSUER}/api/oauth/authorize`,
        params: {
          scope: "openid profile email department",
          display: "popup",
        },
      },
      token: `${process.env.AUTH_HRMS_ISSUER}/api/oauth/token`,
      userinfo: `${process.env.AUTH_HRMS_ISSUER}/api/oauth/userinfo`,
      profile(profile) {
        return {
          id: profile.sub,
          name: profile.name,
          email: profile.email,
          department: profile.department,
        };
      },
    },
  ],
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider && account.provider !== "credentials" && profile) {
        const db = getDb();
        const dbUser = upsertOAuthUser(db, {
          name: user.name || profile.name as string || "",
          email: user.email || profile.email as string || "",
          provider: account.provider,
          providerAccountId: account.providerAccountId,
        });
        user.id = String(dbUser.id);
      }
      return true;
    },
    async jwt({ token, user, profile }) {
      if (user) {
        token.id = user.id;
      }
      if (profile) {
        token.department = (profile as any).department;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.id) {
        session.user.id = token.id as string;
      }
      if (token.department) {
        (session.user as any).department = token.department;
      }
      return session;
    },
  },
  pages: {
    signIn: `${basePath}/login`,
  },
});
