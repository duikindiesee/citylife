import type { CSSProperties } from "react";

export const KOOKERBOOK_MOBILE_MAX_WIDTH = 640;

export type KookerbookResponsiveLayout = {
  html: Pick<CSSProperties, "overflowX">;
  body: Pick<CSSProperties, "margin" | "overflowX">;
  root: Pick<CSSProperties, "width" | "maxWidth" | "overflowX">;
  shell: Pick<
    CSSProperties,
    "flexDirection" | "overflowX" | "width" | "maxWidth" | "gap" | "padding"
  >;
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
      html: { overflowX: "hidden" },
      body: { margin: "0", overflowX: "hidden" },
      root: { width: "100%", maxWidth: "100%", overflowX: "hidden" },
      shell: {
        flexDirection: "column",
        overflowX: "hidden",
        width: "auto",
        maxWidth: "100%",
        gap: 10,
        padding: 10,
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
    html: { overflowX: "hidden" },
    body: { margin: "0", overflowX: "hidden" },
    root: { width: "100%", maxWidth: "100%", overflowX: "hidden" },
    shell: {
      flexDirection: "row",
      overflowX: "hidden",
      width: "100%",
      maxWidth: "100%",
      gap: 16,
      padding: 16,
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
