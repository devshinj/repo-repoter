// src/infra/git/parse-git-url.ts

interface ParsedGitUrl {
  host: string;
  owner: string;
  repo: string;
}

export function parseGitUrl(url: string): ParsedGitUrl {
  if (!url.startsWith("https://") && !url.startsWith("http://")) {
    throw new Error("Only HTTP(S) Git URLs are supported");
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid Git URL: ${url}`);
  }

  const pathParts = parsed.pathname.replace(/^\//, "").replace(/\.git$/, "").split("/");
  if (pathParts.length < 2) {
    throw new Error(`Invalid Git URL path: ${url}`);
  }

  const repo = pathParts[pathParts.length - 1];
  const owner = pathParts.slice(0, -1).join("/");

  return { host: parsed.host, owner, repo };
}

/**
 * git 명령에 전달할 인증용 환경변수를 반환한다.
 * URL에 credential을 넣지 않고 GIT_CONFIG_* 환경변수로 Authorization 헤더를 전달하여
 * self-hosted 서버(Gitea 등)의 URL userinfo 거부 문제를 회피한다.
 */
export function buildAuthEnv(token: string): Record<string, string> {
  const encoded = Buffer.from(`oauth2:${token}`).toString("base64");
  return {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.extraHeader",
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${encoded}`,
  };
}
