import React, { useEffect, useRef } from "react";

export default function LazyChart({ option }) {
  const nodeRef = useRef(null);

  useEffect(() => {
    let disposed = false;
    let chart = null;
    let observer = null;
    let idleHandle = null;

    async function mountChart() {
      const node = nodeRef.current;
      if (!node) return;
      const { default: echarts } = await import("./echartsRuntime.js");
      if (disposed || !nodeRef.current) return;
      chart = echarts.init(node);
      chart.setOption(option);
    }

    const onResize = () => chart?.resize();
    const scheduleMount = () => {
      if (chart || disposed) return;
      if ("requestIdleCallback" in window) {
        idleHandle = window.requestIdleCallback(mountChart, { timeout: 1200 });
      } else {
        idleHandle = window.setTimeout(mountChart, 120);
      }
    };

    if ("IntersectionObserver" in window && nodeRef.current) {
      observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer?.disconnect();
          observer = null;
          scheduleMount();
        }
      }, { rootMargin: "160px" });
      observer.observe(nodeRef.current);
    } else {
      scheduleMount();
    }

    window.addEventListener("resize", onResize);

    return () => {
      disposed = true;
      observer?.disconnect();
      if (idleHandle && "cancelIdleCallback" in window) window.cancelIdleCallback(idleHandle);
      else if (idleHandle) window.clearTimeout(idleHandle);
      window.removeEventListener("resize", onResize);
      chart?.dispose();
    };
  }, [option]);

  return <div className="chart" ref={nodeRef}></div>;
}
