"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Repo } from "@/lib/store/app-store";
import { RepoCard3D } from "./RepoCard3D";

interface SortableRepoCardProps {
  repo: Repo;
  isPinned?: boolean;
  onUnpin?: () => void;
}

export function SortableRepoCard({
  repo,
  isPinned,
  onUnpin,
}: SortableRepoCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: repo.full_name });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
    zIndex: isDragging ? 50 : "auto" as const,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <RepoCard3D
        repo={repo}
        index={0}
        isPinned={isPinned}
        onUnpin={onUnpin}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </div>
  );
}
