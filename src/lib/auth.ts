import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";
import { join } from "path";
import { createTables } from "@/infra/db/schema";
import { getUserByEmail } from "@/infra/db/repository";

function getDb() {
  const db = new Database(join(process.cwd(), "data", "tracker.db"));
  createTables(db);
  return db;
}

export const { handlers, signIn, signOut, auth } = NextAuth({
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
        try {
          const user = getUserByEmail(db, email);
          if (!user) return null;

          const valid = await bcrypt.compare(password, user.password_hash);
          if (!valid) return null;

          return { id: String(user.id), name: user.name, email: user.email };
        } finally {
          db.close();
        }
      },
    }),
    {
      id: "hrms",
      name: "HRMS",
      type: "oidc",
      issuer: process.env.AUTH_HRMS_ISSUER,
      clientId: process.env.AUTH_HRMS_ID,
      clientSecret: process.env.AUTH_HRMS_SECRET,
      authorization: {
        params: {
          scope: "openid profile email department",
          display: "popup",
        },
      },
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
    signIn: "/login",
  },
});
