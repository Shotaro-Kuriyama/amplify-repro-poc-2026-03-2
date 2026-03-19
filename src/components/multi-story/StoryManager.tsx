"use client";

import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { UploadedFile } from "@/types";
import { useI18n } from "@/lib/i18n/context";
import { GripVertical, Layers, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
// Select is still used for start floor selector
import { cn } from "@/lib/utils";

interface StoryManagerProps {
  files: UploadedFile[];
  onReorder: (files: UploadedFile[]) => void;
  onRemove: (id: string) => void;
  startFloor?: string;
  onStartFloorChange?: (value: string) => void;
}

const START_FLOOR_OPTIONS = [
  { value: "1", label: "1F（地上1階）" },
  { value: "0", label: "GF（地上階）" },
  { value: "-1", label: "B1（地下1階）" },
  { value: "-2", label: "B2（地下2階）" },
  { value: "-3", label: "B3（地下3階）" },
];


function SortableItem({
  file,
  onRemove,
}: {
  file: UploadedFile;
  onRemove: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: file.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-2 rounded-lg border bg-card px-2 py-2 transition-shadow",
        isDragging
          ? "z-10 border-cta/40 shadow-lg shadow-cta/10"
          : "border-border/60"
      )}
    >
      <button
        {...attributes}
        {...listeners}
        className="flex h-6 w-6 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground hover:text-foreground active:cursor-grabbing"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>

      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-xs font-semibold text-primary">
        <Layers className="h-3.5 w-3.5" />
      </div>

      {/* Floor label — derived from startFloor + position, read-only */}
      <span className="w-10 text-center text-xs font-semibold text-foreground">
        {file.label}
      </span>

      <span className="flex-1 truncate text-xs text-muted-foreground">
        {file.name}
      </span>

      <Button
        variant="ghost"
        size="icon-xs"
        onClick={() => onRemove(file.id)}
        className="text-muted-foreground hover:text-destructive"
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}

export function StoryManager({
  files,
  onReorder,
  onRemove,
  startFloor = "1",
  onStartFloorChange,
}: StoryManagerProps) {
  const { t } = useI18n();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = files.findIndex((f) => f.id === active.id);
    const newIndex = files.findIndex((f) => f.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = [...files];
    const [moved] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, moved);
    onReorder(reordered);
  }

  if (files.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t.storyManager.title}
        </h3>
        <span className="text-[10px] text-muted-foreground/60">
          {t.storyManager.dragToReorder}
        </span>
      </div>

      {/* Start floor selector */}
      {onStartFloorChange && (
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">
            {t.storyManager.startFloor}:
          </span>
          <Select
            value={startFloor}
            onValueChange={(v: string | null) => {
              if (v) onStartFloorChange(v);
            }}
          >
            <SelectTrigger className="h-7 w-36 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {START_FLOOR_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={files.map((f) => f.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-1.5">
            {files.map((file) => (
              <SortableItem
                key={file.id}
                file={file}
                onRemove={onRemove}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {/* File count summary */}
      <p className="text-[10px] text-muted-foreground/50">
        {files.length} {t.storyManager.floor}
      </p>
    </div>
  );
}
