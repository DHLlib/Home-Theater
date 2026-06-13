import React, { useEffect, useRef, useState } from "react";

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
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  const updateScrollState = () => {
    const el = scrollRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    setAtStart(el.scrollLeft <= 1);
    setAtEnd(maxScroll <= 0 || el.scrollLeft >= maxScroll - 1);
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateScrollState();
    el.addEventListener("scroll", updateScrollState, { passive: true });
    window.addEventListener("resize", updateScrollState);
    return () => {
      el.removeEventListener("scroll", updateScrollState);
      window.removeEventListener("resize", updateScrollState);
    };
  }, []);

  const scroll = (dir: "left" | "right") => {
    const el = scrollRef.current;
    if (!el) return;
    const amount = Math.floor(el.clientWidth * 0.85);
    el.scrollBy({ left: dir === "left" ? -amount : amount, behavior: "smooth" });
  };

  const wrapClass = [
    "scroll-row-wrap",
    atStart ? "at-start" : "",
    atEnd ? "at-end" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={wrapClass}>
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
