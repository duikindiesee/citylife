import type { CSSProperties } from "react";

export const KOOKERBOOK_MOBILE_MAX_WIDTH = 640;

export type KookerbookResponsiveLayout = {
  body: Pick<CSSProperties, "margin" | "overflowX">;
  shell: Pick<CSSProperties, "flexDirection" | "overflowX" | "width" | "maxWidth">;
  panel: Pick<CSSProperties, "maxWidth" | "minWidth" | "overflowX">;
  directory: Pick<CSSProperties, "width" | "maxWidth" | "flexShrink">;
  directoryLink: Pick<CSSProperties, "minHeight">;
  profile: Pick<CSSProperties, "width" | "maxWidth" | "minWidth">;
  profileHeader: Pick<CSSProperties, "flexDirection" | "alignItems">;
  houseRender: Pick<CSSProperties, "width" | "maxWidth" | "minWidth">;
  contentText: Pick<CSSProperties, "minWidth" | "overflowWrap" | "wordBreak">;
};

const WRAPPING_TEXT: KookerbookResponsiveLayout["contentText"] = {
  minWidth: 0,
  overflowWrap: "anywhere",
  wordBreak: "break-word",
};

export function kookerbookLayoutForViewport(
  viewportWidth: number,
): KookerbookResponsiveLayout {
  if (viewportWidth <= KOOKERBOOK_MOBILE_MAX_WIDTH) {
    return {
      body: { margin: "0", overflowX: "hidden" },
      shell: {
        flexDirection: "column",
        overflowX: "hidden",
        width: "auto",
        maxWidth: "100%",
      },
      panel: { maxWidth: "100%", minWidth: 0, overflowX: "hidden" },
      directory: { width: "auto", maxWidth: "100%", flexShrink: 1 },
      directoryLink: { minHeight: 44 },
      profile: { width: "auto", maxWidth: "100%", minWidth: 0 },
      profileHeader: { flexDirection: "column", alignItems: "flex-start" },
      houseRender: { width: "100%", maxWidth: "100%", minWidth: 0 },
      contentText: WRAPPING_TEXT,
    };
  }

  return {
    body: { margin: "0", overflowX: "hidden" },
    shell: {
      flexDirection: "row",
      overflowX: "hidden",
      width: "100%",
      maxWidth: "100%",
    },
    panel: { maxWidth: "100%", minWidth: 0, overflowX: "hidden" },
    directory: { width: 320, maxWidth: 320, flexShrink: 0 },
    directoryLink: { minHeight: 44 },
    profile: { width: "auto", maxWidth: 760, minWidth: 0 },
    profileHeader: { flexDirection: "row", alignItems: "center" },
    houseRender: { width: "100%", maxWidth: "100%", minWidth: 0 },
    contentText: WRAPPING_TEXT,
  };
}
