import React, { useRef } from "react";

function ChevronLeftIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function ChevronRightIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

interface ScrollRowProps {
  title: string;
  titleColor: string;
  children: React.ReactNode;
}

function ScrollRow({ title, titleColor, children }: ScrollRowProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (dir: "left" | "right") => {
    const el = scrollRef.current;
    if (!el) return;
    const amount = Math.floor(el.clientWidth * 0.85);
    el.scrollBy({ left: dir === "left" ? -amount : amount, behavior: "smooth" });
  };

  return (
    <div className="scroll-row-wrap">
      <div className="section-title">
        <span className="section-title-bar" style={{ background: titleColor }} />
        {title}
      </div>
      <button
        className="scroll-arrow left"
        onClick={() => scroll("left")}
        aria-label={`向左滚动 ${title}`}
      >
        <ChevronLeftIcon />
      </button>
      <div ref={scrollRef} className="scroll-row">
        {children}
      </div>
      <button
        className="scroll-arrow right"
        onClick={() => scroll("right")}
        aria-label={`向右滚动 ${title}`}
      >
        <ChevronRightIcon />
      </button>
    </div>
  );
}

export default React.memo(ScrollRow);
