import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Sidebar } from "@/components/layout/sidebar";
import { PageContainer } from "@/components/layout/page-container";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="flex">
      <Sidebar user={{ name: session.user.name || "사용자", email: session.user.email || "" }} />
      <PageContainer>{children}</PageContainer>
    </div>
  );
}
