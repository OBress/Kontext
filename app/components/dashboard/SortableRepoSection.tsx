"use client";

import { useMemo, useState, useCallback } from "react";
import { Repo, RepoSortMode, useAppStore } from "@/lib/store/app-store";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { SortableRepoCard } from "./SortableRepoCard";
import { RepoCard3D } from "./RepoCard3D";
import {
  Pin,
  ArrowUpDown,
  Star,
  Clock,
  SortAsc,
  CalendarPlus,

} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

interface SortableRepoSectionProps {
  repos: Repo[];
}

const SORT_OPTIONS: { mode: RepoSortMode; label: string; icon: React.ReactNode }[] = [
  { mode: "recent", label: "Recently Updated", icon: <Clock size={12} /> },
  { mode: "stars", label: "Stars", icon: <Star size={12} /> },
  { mode: "name", label: "Name A-Z", icon: <SortAsc size={12} /> },
  { mode: "added", label: "Recently Added", icon: <CalendarPlus size={12} /> },
];

function sortRepos(repos: Repo[], mode: RepoSortMode): Repo[] {
  const sorted = [...repos];
  switch (mode) {
    case "recent":
      return sorted.sort(
        (a, b) =>
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      );
    case "stars":
      return sorted.sort((a, b) => b.stargazers_count - a.stargazers_count);
    case "name":
      return sorted.sort((a, b) =>
        a.name.toLowerCase().localeCompare(b.name.toLowerCase())
      );
    case "added":
      // Preserve insertion order (newest first — how they arrive from the store)
      return sorted;
    default:
      return sorted;
  }
}

export function SortableRepoSection({ repos }: SortableRepoSectionProps) {
  const {
    pinnedRepos,
    pinRepo,
    unpinRepo,
    reorderPinnedRepos,
    repoSortMode,
    setRepoSortMode,
  } = useAppStore();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [overPinned, setOverPinned] = useState(false);

  // Sensor: require 5px of movement before starting drag to avoid accidental drags
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  // Build the pinned repo objects (maintaining pin order)
  const pinnedRepoObjects = useMemo(() => {
    return pinnedRepos
      .map((fn) => repos.find((r) => r.full_name === fn))
      .filter(Boolean) as Repo[];
  }, [pinnedRepos, repos]);

  // All repos sorted (includes pinned ones too)
  const sortedAllRepos = useMemo(
    () => sortRepos(repos, repoSortMode),
    [repos, repoSortMode]
  );

  const activeRepo = useMemo(
    () => repos.find((r) => r.full_name === activeId) ?? null,
    [repos, activeId]
  );

  const hasPinnedRepos = pinnedRepoObjects.length > 0;

  // DnD handlers
  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  }, []);

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { over } = event;
      if (!over) {
        setOverPinned(false);
        return;
      }
      // Check if we're over the pinned droppable zone or a pinned card
      const overId = over.id as string;
      if (
        overId === "pinned-drop-zone" ||
        pinnedRepos.includes(overId)
      ) {
        setOverPinned(true);
      } else {
        setOverPinned(false);
      }
    },
    [pinnedRepos]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveId(null);
      setOverPinned(false);

      if (!over) return;

      const draggedId = active.id as string;
      const overId = over.id as string;
      const isPinnedItem = pinnedRepos.includes(draggedId);

      // Dropping onto pinned zone or onto a pinned card
      if (overId === "pinned-drop-zone" || pinnedRepos.includes(overId)) {
        if (!isPinnedItem) {
          // Pin the card
          pinRepo(draggedId);
        } else if (overId !== draggedId && pinnedRepos.includes(overId)) {
          // Reorder within pinned
          const oldIndex = pinnedRepos.indexOf(draggedId);
          const newIndex = pinnedRepos.indexOf(overId);
          if (oldIndex !== -1 && newIndex !== -1) {
            reorderPinnedRepos(arrayMove(pinnedRepos, oldIndex, newIndex));
          }
        }
      }
      // If a pinned card is dropped onto the "all" zone -> unpin it
      // We won't auto-unpin on drop to all — user can click the pin icon to unpin
    },
    [pinnedRepos, pinRepo, reorderPinnedRepos]
  );

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
    setOverPinned(false);
  }, []);

  return (
    <div className="space-y-6">
      {/* Sort toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 mr-2">
          <ArrowUpDown size={13} className="text-[var(--gray-500)]" />
          <span className="font-mono text-xs text-[var(--gray-500)] uppercase tracking-wider">
            Sort
          </span>
        </div>
        {SORT_OPTIONS.map((opt) => (
          <button
            key={opt.mode}
            onClick={() => setRepoSortMode(opt.mode)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full font-mono text-xs border transition-all cursor-pointer ${
              repoSortMode === opt.mode
                ? "bg-[var(--accent-green)]/10 text-[var(--accent-green)] border-[var(--accent-green)]/25"
                : "bg-transparent text-[var(--gray-400)] border-[var(--alpha-white-8)] hover:border-[var(--alpha-white-15)] hover:text-[var(--gray-300)]"
            }`}
          >
            {opt.icon}
            {opt.label}
          </button>
        ))}
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        {/* Pinned section */}
        <AnimatePresence>
          {hasPinnedRepos && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: "easeInOut" }}
              className="overflow-hidden"
            >
              <PinnedContainer
                isHighlighted={!!(overPinned && activeId && !pinnedRepos.includes(activeId))}
              >
                {/* Pinned header */}
                <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--alpha-white-5)]">
                  <Pin size={13} className="text-[var(--accent-green)]" />
                  <span className="font-mono text-xs font-medium text-[var(--gray-200)]">
                    Pinned
                  </span>
                  <span className="font-mono text-xs text-[var(--gray-500)] ml-1">
                    {pinnedRepoObjects.length}/8
                  </span>
                </div>

                {/* Pinned grid */}
                <div className="p-4">
                  <SortableContext
                    items={pinnedRepos}
                    strategy={rectSortingStrategy}
                  >
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
                      {pinnedRepoObjects.map((repo) => (
                        <SortableRepoCard
                          key={repo.full_name}
                          repo={repo}
                          isPinned
                          onUnpin={() => unpinRepo(repo.full_name)}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </div>
              </PinnedContainer>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Empty pinned drop zone (only visible during drag when nothing is pinned) */}
        {!hasPinnedRepos && activeId && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <EmptyPinnedDropZone isOver={overPinned} />
          </motion.div>
        )}

        {/* All repos section header */}
        <h2 className="font-mono text-sm uppercase tracking-wider text-[var(--gray-500)] mb-4 m-0">
          {hasPinnedRepos ? "All Repositories" : "Your Repositories"}
        </h2>

        {/* All repos grid */}
        <SortableContext
          items={sortedAllRepos.map((r) => r.full_name)}
          strategy={rectSortingStrategy}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {sortedAllRepos.map((repo) => (
              <SortableRepoCard
                key={repo.full_name}
                repo={repo}
                isPinned={pinnedRepos.includes(repo.full_name)}
                onUnpin={
                  pinnedRepos.includes(repo.full_name)
                    ? () => unpinRepo(repo.full_name)
                    : undefined
                }
              />
            ))}
          </div>
        </SortableContext>

        {/* Drag overlay — rendered at portal level so it floats above everything */}
        <DragOverlay dropAnimation={null}>
          {activeRepo ? (
            <div className="drag-overlay">
              <RepoCard3D repo={activeRepo} index={0} isDragOverlay />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

/** Droppable wrapper for the populated pinned section */
function PinnedContainer({
  children,
  isHighlighted,
}: {
  children: React.ReactNode;
  isHighlighted: boolean;
}) {
  const { setNodeRef } = useDroppable({ id: "pinned-drop-zone" });
  return (
    <div
      ref={setNodeRef}
      className={`rounded-xl border transition-all duration-200 mb-6 ${
        isHighlighted
          ? "drop-zone-active border-[rgba(63,185,80,0.3)]"
          : "border-[var(--alpha-white-5)]"
      }`}
      style={{ background: "rgba(13, 17, 23, 0.4)" }}
    >
      {children}
    </div>
  );
}

/** Droppable empty state shown during drag when no repos are pinned */
function EmptyPinnedDropZone({ isOver }: { isOver: boolean }) {
  const { setNodeRef } = useDroppable({ id: "pinned-drop-zone" });
  return (
    <div
      ref={setNodeRef}
      className={`rounded-xl border-2 border-dashed transition-all duration-200 mb-6 flex items-center justify-center py-8 ${
        isOver
          ? "drop-zone-active border-[rgba(63,185,80,0.3)]"
          : "border-[var(--alpha-white-8)]"
      }`}
    >
      <div className="flex items-center gap-2 text-[var(--gray-500)]">
        <Pin size={14} />
        <span className="font-mono text-xs">Drop here to pin</span>
      </div>
    </div>
  );
}
