import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import type { AggregatedVideo, HomeSection, SystemCategoryTreeItem } from "../types";
import "./HomeCategorySections.css";

export interface HomeCategorySectionsProps {
  sections: HomeSection[];
  categories?: SystemCategoryTreeItem[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  onViewAll: (category: string) => void;
  renderItem: (item: AggregatedVideo) => ReactNode;
}

function itemKey(item: AggregatedVideo, index: number): string {
  if (item.id != null) return `id-${item.id}`;
  const source = item.sources[0];
  if (source) return `source-${source.site_id}-${source.original_id}`;
  return `video-${item.title}-${item.year ?? "unknown"}-${index}`;
}

function HomeCategorySections({
  sections,
  categories = [],
  isLoading,
  isError,
  onRetry,
  onViewAll,
  renderItem,
}: HomeCategorySectionsProps) {
  const instanceId = useId().replace(/:/g, "");
  const rootId = `${instanceId}-home-sections`;
  const rootRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const sectionRefs = useRef<Array<HTMLElement | null>>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const visibleSections = useMemo(
    () => sections.filter((section) => section.items.length > 0),
    [sections]
  );
  // 首页分类栏同时展示「0 内容」的启用大类：弱化显示，点击进入分类页空态。
  const navCategories = useMemo(() => {
    const names = categories
      .filter((category) => category.enabled !== false)
      .map((category) => category.name);
    for (const section of visibleSections) {
      if (!names.includes(section.category)) names.push(section.category);
    }
    return names;
  }, [categories, visibleSections]);

  useEffect(() => {
    if (visibleSections.length === 0) return;

    const updateActiveSection = () => {
      const nav = navRef.current;
      const root = rootRef.current;
      if (!nav || !root) return;

      const parsedOffset = Number.parseFloat(window.getComputedStyle(nav).top);
      const navOffset = Number.isFinite(parsedOffset) ? parsedOffset : 64;
      const threshold = navOffset + nav.getBoundingClientRect().height + 24;

      if (window.scrollY <= 0 || root.getBoundingClientRect().top > threshold) {
        setActiveCategory(null);
        return;
      }

      let nextCategory: string | null = null;
      sectionRefs.current.forEach((section, index) => {
        if (section && section.getBoundingClientRect().top <= threshold) {
          nextCategory = visibleSections[index]?.category ?? nextCategory;
        }
      });
      setActiveCategory(nextCategory);
    };

    updateActiveSection();
    window.addEventListener("scroll", updateActiveSection, { passive: true });
    window.addEventListener("resize", updateActiveSection);
    return () => {
      window.removeEventListener("scroll", updateActiveSection);
      window.removeEventListener("resize", updateActiveSection);
    };
  }, [visibleSections]);

  useEffect(() => {
    if (
      activeCategory &&
      !visibleSections.some((section) => section.category === activeCategory)
    ) {
      setActiveCategory(null);
    }
  }, [activeCategory, visibleSections]);

  const scrollTo = (
    event: MouseEvent<HTMLAnchorElement>,
    targetId: string,
    category: string | null
  ) => {
    event.preventDefault();
    setActiveCategory(category);
    const target = document.getElementById(targetId);
    if (!target || typeof target.scrollIntoView !== "function") return;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    target.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "start",
    });
  };

  if (isLoading && visibleSections.length === 0) {
    return (
      <div
        className="home-category-sections"
        aria-busy="true"
        aria-label="正在加载分类视频"
      >
        <div className="home-category-sections__items home-category-sections__skeletons">
          {Array.from({ length: 8 }, (_, index) => (
            <div className="home-category-sections__item" key={index}>
              <div className="skeleton home-category-sections__skeleton-poster" />
              <div className="skeleton home-category-sections__skeleton-title" />
              <div className="skeleton home-category-sections__skeleton-meta" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (isError && visibleSections.length === 0) {
    return (
      <div className="home-category-sections">
        <div className="home-category-sections__status" role="alert">
          <p>分类视频加载失败，请稍后重试。</p>
          <button type="button" className="btn" onClick={onRetry}>
            重试
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="home-category-sections" id={rootId} ref={rootRef}>
      <nav className="home-category-sections__nav" aria-label="首页分类" ref={navRef}>
        <a
          className="home-category-sections__anchor"
          href={`#${rootId}`}
          aria-current={activeCategory === null ? "location" : undefined}
          onClick={(event) => scrollTo(event, rootId, null)}
        >
          全部
        </a>
        {navCategories.map((category) => {
          const section = visibleSections.find((item) => item.category === category);
          const index = section ? visibleSections.indexOf(section) : -1;
          const sectionId = `${instanceId}-home-section-${index}`;
          if (!section) {
            return (
              <button
                type="button"
                className="home-category-sections__anchor home-category-sections__anchor--empty"
                key={category}
                title={`${category}暂无内容，进入分类页`}
                onClick={() => onViewAll(category)}
              >
                {category}
              </button>
            );
          }
          return (
            <a
              className="home-category-sections__anchor"
              href={`#${sectionId}`}
              aria-current={
                activeCategory === section.category ? "location" : undefined
              }
              key={section.category}
              onClick={(event) => scrollTo(event, sectionId, section.category)}
            >
              {section.category}
            </a>
          );
        })}
      </nav>

      <div className="home-category-sections__content">
        {visibleSections.length === 0 && (
          <div className="home-category-sections__status">
            <p>还没有已挂载的分类内容。到「设置 → 分类设置」把站点远程分类挂到小类后再来看。</p>
          </div>
        )}
        {visibleSections.map((section, index) => {
          const sectionId = `${instanceId}-home-section-${index}`;
          const headingId = `${sectionId}-heading`;
          return (
            <section
              className="home-category-sections__section"
              id={sectionId}
              aria-labelledby={headingId}
              key={section.category}
              ref={(node) => {
                sectionRefs.current[index] = node;
              }}
            >
              <div className="home-category-sections__header">
                <div className="home-category-sections__heading-group">
                  <h2 className="home-category-sections__heading" id={headingId}>
                    {section.category}
                  </h2>
                  <span className="home-category-sections__count">
                    最新 {section.items.length} 部
                  </span>
                </div>
                <button
                  type="button"
                  className="home-category-sections__view-all"
                  aria-label={`查看全部${section.category}`}
                  onClick={() => onViewAll(section.category)}
                >
                  查看全部
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                </button>
              </div>
              <div
                className="home-category-sections__items"
                role="list"
                aria-label={`${section.category}最新视频`}
                tabIndex={0}
              >
                {section.items.map((item, itemIndex) => (
                  <div
                    className="home-category-sections__item"
                    role="listitem"
                    key={itemKey(item, itemIndex)}
                  >
                    {renderItem(item)}
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

export default HomeCategorySections;
