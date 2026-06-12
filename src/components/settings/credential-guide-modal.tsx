"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { GitProviderIcon } from "@/components/data-display/git-provider-icon";
import {
  ExternalLink,
  Shield,
  Copy,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";

interface CredentialGuideModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface GuideStep {
  title: string;
  description: string;
  detail?: string;
}

interface ProviderGuide {
  name: string;
  type: string;
  tokenName: string;
  settingsPath: string;
  url: string;
  scopes: { name: string; description: string; required: boolean }[];
  steps: GuideStep[];
  tips: string[];
}

const providerGuides: ProviderGuide[] = [
  {
    name: "GitHub",
    type: "github",
    tokenName: "Personal Access Token (Classic)",
    settingsPath: "Settings > Developer settings > Personal access tokens > Tokens (classic)",
    url: "https://github.com/settings/tokens",
    scopes: [
      { name: "repo", description: "프라이빗 저장소 접근 (전체)", required: true },
      { name: "read:user", description: "사용자 프로필 정보 읽기", required: false },
    ],
    steps: [
      {
        title: "토큰 설정 페이지 이동",
        description: "GitHub에 로그인 후 Settings > Developer settings > Personal access tokens > Tokens (classic) 으로 이동합니다.",
      },
      {
        title: "Generate new token 클릭",
        description: "\"Generate new token (classic)\" 버튼을 클릭합니다.",
        detail: "Fine-grained token도 사용 가능하지만, Classic이 설정이 더 간단합니다.",
      },
      {
        title: "토큰 이름 및 만료일 설정",
        description: "Note에 용도를 입력하고 (예: AutoBriify), Expiration은 90일 이상을 권장합니다.",
      },
      {
        title: "권한(Scopes) 선택",
        description: "repo 항목을 체크합니다. 퍼블릭 저장소만 사용한다면 public_repo만 체크해도 됩니다.",
      },
      {
        title: "토큰 생성 및 복사",
        description: "\"Generate token\" 클릭 후, 생성된 토큰(ghp_로 시작)을 즉시 복사합니다.",
        detail: "페이지를 떠나면 토큰을 다시 볼 수 없습니다. 반드시 복사 후 등록하세요.",
      },
    ],
    tips: [
      "토큰은 ghp_ 로 시작합니다",
      "만료된 토큰은 '토큰 갱신'으로 교체할 수 있습니다",
      "조직 저장소 접근 시 SSO 인증이 필요할 수 있습니다",
    ],
  },
  {
    name: "GitLab",
    type: "gitlab",
    tokenName: "Personal Access Token",
    settingsPath: "User Settings > Access Tokens",
    url: "https://gitlab.com/-/user_settings/personal_access_tokens",
    scopes: [
      { name: "read_api", description: "API 읽기 접근", required: true },
      { name: "read_repository", description: "저장소 코드 읽기", required: true },
    ],
    steps: [
      {
        title: "Access Tokens 페이지 이동",
        description: "GitLab에 로그인 후 왼쪽 사이드바 아바타 클릭 > Edit profile > Access Tokens 으로 이동합니다.",
      },
      {
        title: "Add new token 클릭",
        description: "\"Add new token\" 버튼을 클릭합니다.",
      },
      {
        title: "토큰 정보 입력",
        description: "Token name에 용도를 입력하고, Expiration date를 설정합니다. 최대 1년까지 설정 가능합니다.",
      },
      {
        title: "권한(Scopes) 선택",
        description: "read_api와 read_repository를 체크합니다.",
      },
      {
        title: "토큰 생성 및 복사",
        description: "\"Create personal access token\" 클릭 후, 생성된 토큰(glpat-로 시작)을 즉시 복사합니다.",
        detail: "페이지를 떠나면 토큰을 다시 볼 수 없습니다.",
      },
    ],
    tips: [
      "토큰은 glpat- 로 시작합니다",
      "Self-hosted GitLab은 호스트 URL 입력이 필요합니다",
      "그룹 토큰은 해당 그룹의 저장소에만 접근 가능합니다",
    ],
  },
  {
    name: "Gitea",
    type: "gitea",
    tokenName: "Access Token",
    settingsPath: "Settings > Applications > Access Tokens",
    url: "",
    scopes: [
      { name: "repository:read", description: "저장소 읽기 권한", required: true },
      { name: "user:read", description: "사용자 정보 읽기", required: false },
    ],
    steps: [
      {
        title: "설정 페이지 이동",
        description: "Gitea 인스턴스에 로그인 후 오른쪽 상단 아바타 > Settings > Applications 으로 이동합니다.",
      },
      {
        title: "토큰 이름 입력",
        description: "\"Token Name\" 필드에 용도를 입력합니다 (예: AutoBriify).",
      },
      {
        title: "권한 선택",
        description: "Select permissions에서 Repository를 Read로 설정합니다.",
        detail: "Gitea 1.19+ 부터 세분화된 권한 선택이 가능합니다. 이전 버전은 전체 접근 토큰이 생성됩니다.",
      },
      {
        title: "토큰 생성 및 복사",
        description: "\"Generate Token\" 클릭 후, 생성된 토큰을 즉시 복사합니다.",
        detail: "토큰은 한 번만 표시됩니다.",
      },
    ],
    tips: [
      "호스트 URL에는 Gitea 인스턴스 주소만 입력합니다 (예: gitea.company.com)",
      "https:// 접두사는 자동으로 추가됩니다",
      "API 경로(/api/v1)는 자동 설정되므로 입력하지 마세요",
    ],
  },
  {
    name: "Bitbucket",
    type: "bitbucket",
    tokenName: "App Password",
    settingsPath: "Personal settings > App passwords",
    url: "https://bitbucket.org/account/settings/app-passwords/",
    scopes: [
      { name: "Repositories: Read", description: "저장소 읽기 접근", required: true },
      { name: "Account: Read", description: "계정 정보 읽기", required: false },
    ],
    steps: [
      {
        title: "App passwords 페이지 이동",
        description: "Bitbucket에 로그인 후 왼쪽 하단 톱니바퀴 > Personal Bitbucket settings > App passwords 로 이동합니다.",
      },
      {
        title: "Create app password 클릭",
        description: "\"Create app password\" 버튼을 클릭합니다.",
      },
      {
        title: "라벨 입력 및 권한 선택",
        description: "Label에 용도를 입력하고, Permissions에서 Repositories > Read를 체크합니다.",
      },
      {
        title: "비밀번호 생성 및 복사",
        description: "\"Create\" 클릭 후, 생성된 App password를 즉시 복사합니다.",
        detail: "이 비밀번호는 다시 확인할 수 없습니다. 반드시 바로 복사하세요.",
      },
    ],
    tips: [
      "Bitbucket은 PAT 대신 App Password를 사용합니다",
      "2단계 인증이 활성화된 경우 App Password가 필수입니다",
      "Bitbucket Server(자체 호스팅)는 호스트 URL 입력이 필요합니다",
    ],
  },
];

function StepNumber({ num }: { num: number }) {
  return (
    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold ring-1 ring-primary/20 flex-shrink-0">
      {num}
    </span>
  );
}

function ProviderGuideContent({ guide }: { guide: ProviderGuide }) {
  return (
    <div className="space-y-5 animate-in fade-in-0 duration-200">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-muted ring-1 ring-border">
          <GitProviderIcon type={guide.type} className="h-5 w-5 text-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-medium text-sm">{guide.tokenName}</h3>
          <p className="text-xs text-muted-foreground font-mono tracking-tight truncate">
            {guide.settingsPath}
          </p>
        </div>
        {guide.url && (
          <a
            href={guide.url}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto flex-shrink-0 flex items-center gap-1 text-xs text-primary whitespace-nowrap hover:underline underline-offset-2 transition-colors"
          >
            바로가기
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      <Separator />

      {/* Required Scopes */}
      <div>
        <div className="flex items-center gap-1.5 mb-2.5">
          <Shield className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            필요 권한
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {guide.scopes.map((scope) => (
            <Badge
              key={scope.name}
              variant={scope.required ? "default" : "secondary"}
              className="font-mono text-[11px] gap-1"
            >
              {scope.name}
              {scope.required && (
                <span className="text-[9px] opacity-70">필수</span>
              )}
            </Badge>
          ))}
        </div>
        <div className="mt-2 space-y-0.5">
          {guide.scopes.map((scope) => (
            <p key={scope.name} className="text-[11px] text-muted-foreground">
              <code className="bg-muted px-1 py-0.5 rounded text-[10px]">{scope.name}</code>
              {" "}&mdash; {scope.description}
            </p>
          ))}
        </div>
      </div>

      <Separator />

      {/* Steps */}
      <div className="space-y-3">
        {guide.steps.map((step, i) => (
          <div key={i} className="flex gap-3">
            <StepNumber num={i + 1} />
            <div className="flex-1 min-w-0 pt-0.5">
              <p className="text-sm font-medium leading-tight">{step.title}</p>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                {step.description}
              </p>
              {step.detail && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1.5 flex items-start gap-1">
                  <AlertTriangle className="h-3 w-3 flex-shrink-0 mt-0.5" />
                  <span>{step.detail}</span>
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

      <Separator />

      {/* Tips */}
      <div className="rounded-lg bg-muted/50 ring-1 ring-border p-3 space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5" />
          참고 사항
        </p>
        {guide.tips.map((tip, i) => (
          <p key={i} className="text-xs text-muted-foreground pl-5 leading-relaxed">
            &bull; {tip}
          </p>
        ))}
      </div>
    </div>
  );
}

export function CredentialGuideModal({
  open,
  onOpenChange,
}: CredentialGuideModalProps) {
  const [activeTab, setActiveTab] = useState("github");

  const activeGuide = providerGuides.find((g) => g.type === activeTab)!;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>자격증명 등록 가이드</DialogTitle>
          <DialogDescription>
            Git 서비스별 토큰 발급 방법을 안내합니다
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as string)}>
          <TabsList variant="line" className="w-full justify-start">
            {providerGuides.map((guide) => (
              <TabsTrigger key={guide.type} value={guide.type} className="gap-1.5 text-xs">
                <GitProviderIcon type={guide.type} className="h-3.5 w-3.5" />
                {guide.name}
              </TabsTrigger>
            ))}
          </TabsList>

          {providerGuides.map((guide) => (
            <TabsContent key={guide.type} value={guide.type} className="mt-4">
              <ProviderGuideContent guide={guide} />
            </TabsContent>
          ))}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
