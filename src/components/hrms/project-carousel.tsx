"use client";

import { useEffect, useState, useRef } from "react";
import { ChevronLeft, ChevronRight, Briefcase, Calendar, Users } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EnrichedProject {
  id: number;
  name: string;
  description: string | null;
  status: string;
  statusLabel: string;
  statusColor: string;
  projectType: string | null;
  typeLabel: string | null;
  typeColor: string | null;
  teamName: string | null;
  groupName: string | null;
  contractDate: string | null;
  contractEndDate: string | null;
}

// 상태별 그라데이션 테마
function getStatusTheme(status: string) {
  switch (status) {
    case "PROJ_PROGRESS":
      return { gradient: "from-emerald-500/10 to-teal-500/5", border: "border-emerald-500/30", dot: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400" };
    case "PROJ_CONTRACT":
      return { gradient: "from-cyan-500/10 to-blue-500/5", border: "border-cyan-500/30", dot: "bg-cyan-500", text: "text-cyan-600 dark:text-cyan-400" };
    case "PROJ_PROPOSAL":
      return { gradient: "from-violet-500/10 to-purple-500/5", border: "border-violet-500/30", dot: "bg-violet-500", text: "text-violet-600 dark:text-violet-400" };
    case "PROJ_COMPLETE":
      return { gradient: "from-slate-500/10 to-gray-500/5", border: "border-slate-500/30", dot: "bg-slate-400", text: "text-slate-500 dark:text-slate-400" };
    case "PROJ_HOLD":
      return { gradient: "from-amber-500/10 to-orange-500/5", border: "border-amber-500/30", dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-400" };
    default:
      return { gradient: "from-gray-500/10 to-gray-500/5", border: "border-gray-500/30", dot: "bg-gray-400", text: "text-gray-500" };
  }
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  return dateStr.slice(2, 10).replace(/-/g, ".");
}

function ProjectCard({ project }: { project: EnrichedProject }) {
  const theme = getStatusTheme(project.status);
  const startDate = formatDate(project.contractDate);
  const endDate = formatDate(project.contractEndDate);

  return (
    <div
      className={`
        relative flex-shrink-0 w-[280px] rounded-xl border ${theme.border}
        bg-gradient-to-br ${theme.gradient} backdrop-blur-sm
        p-4 transition-all duration-200
        hover:shadow-lg hover:shadow-black/5 dark:hover:shadow-black/20
        hover:-translate-y-0.5
        group cursor-default select-none
      `}
    >
      {/* 상단: 상태 dot + 프로젝트명 */}
      <div className="flex items-start gap-2.5 mb-3">
        <div className={`w-2 h-2 rounded-full ${theme.dot} mt-1.5 flex-shrink-0 ring-2 ring-white/50 dark:ring-black/30`} />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold truncate leading-tight" title={project.name}>
            {project.name}
          </h3>
          {project.description && (
            <p className="text-[11px] text-muted-foreground truncate mt-0.5" title={project.description}>
              {project.description}
            </p>
          )}
        </div>
      </div>

      {/* 칩 라인 */}
      <div className="flex items-center gap-1.5 flex-wrap mb-2.5">
        <span className={`inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded ${theme.text} bg-white/60 dark:bg-white/10`}>
          {project.statusLabel}
        </span>
        {project.typeLabel && (
          <span className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded text-muted-foreground bg-white/40 dark:bg-white/5">
            {project.typeLabel}
          </span>
        )}
      </div>

      {/* 팀/그룹 + 날짜 */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <div className="flex items-center gap-1 min-w-0 truncate">
          <Users className="h-3 w-3 flex-shrink-0 opacity-50" />
          <span className="truncate">
            {[project.groupName, project.teamName].filter(Boolean).join(" · ") || "—"}
          </span>
        </div>
        {(startDate || endDate) && (
          <div className="flex items-center gap-1 flex-shrink-0 ml-2">
            <Calendar className="h-3 w-3 opacity-50" />
            <span>{startDate}~{endDate}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function ProjectCarousel() {
  const [projects, setProjects] = useState<EnrichedProject[]>([]);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  // 마우스 드래그 스크롤
  const isDragging = useRef(false);
  const startX = useRef(0);
  const scrollLeft = useRef(0);

  function handleMouseDown(e: React.MouseEvent) {
    const el = scrollRef.current;
    if (!el) return;
    isDragging.current = true;
    startX.current = e.pageX - el.offsetLeft;
    scrollLeft.current = el.scrollLeft;
    el.style.cursor = "grabbing";
    el.style.userSelect = "none";
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!isDragging.current) return;
    const el = scrollRef.current;
    if (!el) return;
    e.preventDefault();
    const x = e.pageX - el.offsetLeft;
    const walk = (x - startX.current) * 1.5;
    el.scrollLeft = scrollLeft.current - walk;
  }

  function handleMouseUp() {
    isDragging.current = false;
    const el = scrollRef.current;
    if (el) {
      el.style.cursor = "grab";
      el.style.userSelect = "";
    }
  }

  useEffect(() => {
    fetch("/api/hrms/projects-enriched")
      .then(r => r.ok ? r.json() : [])
      .then(data => setProjects(Array.isArray(data) ? data : []))
      .catch(() => setProjects([]))
      .finally(() => setLoading(false));
  }, []);

  function updateScrollState() {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 1);
  }

  useEffect(() => {
    updateScrollState();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateScrollState, { passive: true });
    const ro = new ResizeObserver(updateScrollState);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", updateScrollState); ro.disconnect(); };
  }, [projects]);

  function scroll(direction: "left" | "right") {
    const el = scrollRef.current;
    if (!el) return;
    const cardWidth = 296; // 280 + 16 gap
    el.scrollBy({ left: direction === "left" ? -cardWidth : cardWidth, behavior: "smooth" });
  }

  if (loading) {
    return (
      <div className="flex items-center gap-4 overflow-hidden">
        {[1, 2, 3].map(i => (
          <div key={i} className="flex-shrink-0 w-[280px] h-[110px] rounded-xl bg-muted/50 animate-pulse" />
        ))}
      </div>
    );
  }

  if (projects.length === 0) return null;

  return (
    <div className="relative group/carousel">
      {/* 섹션 헤더 */}
      <div className="flex items-center gap-2 mb-3">
        <Briefcase className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">참여 프로젝트</span>
        <span className="text-xs text-muted-foreground">{projects.length}건</span>
      </div>

      {/* 스크롤 컨테이너 */}
      <div className="relative">
        {/* 좌측 화살표 */}
        {canScrollLeft && (
          <div className="absolute left-0 top-0 bottom-0 z-10 flex items-center">
            <div className="absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-background to-transparent pointer-events-none" />
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 rounded-full shadow-md bg-background/90 backdrop-blur-sm relative"
              onClick={() => scroll("left")}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* 우측 화살표 */}
        {canScrollRight && (
          <div className="absolute right-0 top-0 bottom-0 z-10 flex items-center">
            <div className="absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-background to-transparent pointer-events-none" />
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 rounded-full shadow-md bg-background/90 backdrop-blur-sm relative"
              onClick={() => scroll("right")}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* 카드 리스트 */}
        <div
          ref={scrollRef}
          className="flex gap-4 overflow-x-auto scrollbar-none"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none", cursor: "grab" }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          {projects.map(p => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      </div>
    </div>
  );
}
