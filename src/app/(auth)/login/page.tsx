import { signIn } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Git-Notion Task Tracker</CardTitle>
          <CardDescription>HRMS 계정으로 로그인하세요</CardDescription>
        </CardHeader>
        <form
          action={async () => {
            "use server";
            await signIn("hrms");
          }}
        >
          <Button type="submit" className="w-full">
            HRMS로 로그인
          </Button>
        </form>
      </Card>
    </div>
  );
}
