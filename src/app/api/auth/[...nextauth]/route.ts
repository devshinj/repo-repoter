import { handlers } from "@/lib/auth";
import { NextRequest } from "next/server";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

function withBasePath(handler: (req: NextRequest) => Promise<Response>) {
  return (req: NextRequest) => {
    if (!basePath) return handler(req);
    // Next.js가 basePath를 벗겨낸 URL을 Auth.js에 전달하면 파싱 실패.
    // basePath를 다시 붙여서 Auth.js가 올바르게 처리하도록 한다.
    const url = new URL(req.url);
    url.pathname = `${basePath}${url.pathname}`;
    return handler(new NextRequest(url, req));
  };
}

export const GET = withBasePath(handlers.GET);
export const POST = withBasePath(handlers.POST);
