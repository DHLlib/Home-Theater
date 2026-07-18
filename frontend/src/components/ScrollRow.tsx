import React, { useEffect, useRef, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "./icons";

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
        <ChevronLeftIcon size={20} />
      </button>
      <div ref={scrollRef} className="scroll-row">
        {children}
      </div>
      <button
        className="scroll-arrow right"
        onClick={() => scroll("right")}
        aria-label={`向右滚动 ${title}`}
      >
        <ChevronRightIcon size={20} />
      </button>
    </div>
  );
}

export default React.memo(ScrollRow);
