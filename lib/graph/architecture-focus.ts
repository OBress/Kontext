export interface ArchitectureAssistantViewportState {
  open: boolean;
  isMobile: boolean;
  width: number;
}

const BASE_PADDING = {
  top: 72,
  right: 96,
  bottom: 72,
  left: 96,
} as const;

const DEFAULT_AUTO_FOCUS_MAX_ZOOM = 0.82;
const ASSISTANT_OPEN_AUTO_FOCUS_MAX_ZOOM = 0.62;
const DEFAULT_AUTO_FOCUS_MIN_ZOOM = 0.22;

export function getArchitectureAutoFocusPadding(
  assistant: ArchitectureAssistantViewportState | null
) {
  if (!assistant || !assistant.open || assistant.isMobile) {
    return { ...BASE_PADDING };
  }

  return {
    ...BASE_PADDING,
    right: Math.max(BASE_PADDING.right, Math.round(assistant.width + 56)),
  };
}

export function getArchitectureAutoFocusMaxZoom(
  currentZoom: number,
  assistant: ArchitectureAssistantViewportState | null
) {
  const cap =
    assistant && assistant.open && !assistant.isMobile
      ? ASSISTANT_OPEN_AUTO_FOCUS_MAX_ZOOM
      : DEFAULT_AUTO_FOCUS_MAX_ZOOM;

  return Math.max(currentZoom, cap);
}

export function getArchitectureAutoFocusMinZoom(currentZoom: number) {
  return Math.min(currentZoom, DEFAULT_AUTO_FOCUS_MIN_ZOOM);
}
