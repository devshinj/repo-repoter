"use client";

import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandItem, CommandEmpty } from "@/components/ui/command";
import { FolderGit2, ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { projectColor, oklch } from "@/lib/color-hash";

interface Repo {
  id: number;
  owner: string;
  repo: string;
  label?: string | null;
}

interface RepoFilterProps {
  repos: Repo[];
  selectedIds: Set<number>;
  onSelectionChange: (ids: Set<number>) => void;
}

export function RepoFilter({ repos, selectedIds, onSelectionChange }: RepoFilterProps) {
  const [open, setOpen] = useState(false);

  const allSelected = repos.length > 0 && selectedIds.size === repos.length;

  function toggleAll() {
    if (allSelected) {
      onSelectionChange(new Set());
    } else {
      onSelectionChange(new Set(repos.map((r) => r.id)));
    }
  }

  function toggle(id: number) {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    onSelectionChange(next);
  }

  const selectedRepos = repos.filter((r) => selectedIds.has(r.id));
  const visibleChips = selectedRepos.slice(0, 3);
  const moreCount = selectedRepos.length - visibleChips.length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-xs font-medium shadow-sm hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
        <FolderGit2 className="h-3.5 w-3.5" />
        {selectedIds.size === 0 ? (
          "저장소 선택"
        ) : selectedIds.size === repos.length ? (
          "전체 저장소"
        ) : (
          <span className="flex items-center gap-1">
            {visibleChips.map((r) => {
              const color = projectColor(`${r.owner}/${r.repo}`);
              return (
                <Badge
                  key={r.id}
                  variant="secondary"
                  className="text-[10px] px-1.5 py-0 font-normal"
                  style={{ backgroundColor: oklch(color.bgLight), color: oklch(color.solid) }}
                >
                  {r.label || r.repo}
                </Badge>
              );
            })}
            {moreCount > 0 && (
              <span className="text-muted-foreground">+{moreCount}</span>
            )}
          </span>
        )}
        <ChevronDown className="h-3 w-3 ml-1 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder="저장소 검색..." />
          <CommandList>
            <CommandEmpty>저장소를 찾을 수 없습니다</CommandEmpty>
            <CommandItem onSelect={toggleAll} className="gap-2">
              <Checkbox checked={allSelected} />
              <span className="font-medium text-xs">전체 선택</span>
            </CommandItem>
            <div className="h-px bg-border mx-1 my-1" />
            {repos.map((repo) => {
              const color = projectColor(`${repo.owner}/${repo.repo}`);
              return (
                <CommandItem key={repo.id} onSelect={() => toggle(repo.id)} className="gap-2">
                  <Checkbox checked={selectedIds.has(repo.id)} />
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: oklch(color.solid) }}
                  />
                  <span className="text-xs">{repo.label || `${repo.owner}/${repo.repo}`}</span>
                </CommandItem>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
