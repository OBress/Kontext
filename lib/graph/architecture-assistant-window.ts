export interface AssistantViewport {
  width: number;
  height: number;
}

export interface AssistantWindowSize {
  width: number;
  height: number;
}

export interface AssistantWindowPosition {
  x: number;
  y: number;
}

export const DEFAULT_ASSISTANT_WIDTH = 560;
export const DEFAULT_ASSISTANT_HEIGHT = 640;
export const MIN_ASSISTANT_WIDTH = 420;
export const MIN_ASSISTANT_HEIGHT = 420;

export function clampAssistantWindowSize(
  size: AssistantWindowSize,
  viewport: AssistantViewport
): AssistantWindowSize {
  return {
    width: Math.min(
      Math.max(size.width, MIN_ASSISTANT_WIDTH),
      Math.max(320, viewport.width - 24)
    ),
    height: Math.min(
      Math.max(size.height, MIN_ASSISTANT_HEIGHT),
      Math.max(320, viewport.height - 32)
    ),
  };
}

export function clampAssistantWindowPosition(
  position: AssistantWindowPosition,
  size: AssistantWindowSize,
  viewport: AssistantViewport
): AssistantWindowPosition {
  return {
    x: Math.min(
      Math.max(position.x, 12),
      Math.max(12, viewport.width - size.width - 12)
    ),
    y: Math.min(
      Math.max(position.y, 12),
      Math.max(12, viewport.height - size.height - 12)
    ),
  };
}

export function getDefaultAssistantWindowPosition(
  size: AssistantWindowSize,
  viewport: AssistantViewport
): AssistantWindowPosition {
  return clampAssistantWindowPosition(
    {
      x: viewport.width - size.width - 32,
      y: viewport.height - size.height - 32,
    },
    size,
    viewport
  );
}
