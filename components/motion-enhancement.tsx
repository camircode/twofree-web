"use client";

import { useEffect, useState } from "react";

import { getMotionCapabilities } from "@camircode/twofree-ui";

type MotionMode = "enhanced" | "reduced";

export function MotionEnhancement() {
  const [motionMode, setMotionMode] = useState<MotionMode>("reduced");

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    const syncMotionMode = () => {
      const nextMode: MotionMode = getMotionCapabilities().reducedMotion ? "reduced" : "enhanced";
      setMotionMode(nextMode);
      document.documentElement.dataset.motion = nextMode;
    };

    syncMotionMode();
    mediaQuery.addEventListener?.("change", syncMotionMode);

    return () => {
      mediaQuery.removeEventListener?.("change", syncMotionMode);
      delete document.documentElement.dataset.motion;
    };
  }, []);

  return (
    <span
      aria-hidden="true"
      className="workspace-shell__motion-enhancement"
      data-motion={motionMode}
      data-motion-enhancement
      data-motion-mode={motionMode}
    />
  );
}
