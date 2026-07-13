import React from "react";

export default function ModuleFallback({ title = "模块加载中", variant = "feature" }) {
  const className = variant === "detail" ? "detail-section module-fallback" : "feature-panel module-fallback";
  return (
    <section className={className}>
      <strong>{title}</strong>
      <span>正在打开真实数据面板...</span>
    </section>
  );
}
