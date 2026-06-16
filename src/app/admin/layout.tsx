import { AdminAuthGate } from "@/components/admin/admin-auth-gate";
import { AdminNav } from "@/components/admin/admin-nav";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminAuthGate>
      <div className="min-h-screen bg-background">
        <AdminNav />
        <main className="p-5">{children}</main>
      </div>
    </AdminAuthGate>
  );
}
