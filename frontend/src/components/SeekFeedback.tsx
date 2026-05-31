import { useEffect, useState } from "react";

interface SeekFeedbackProps {
  direction: "left" | "right" | null;
  visible: boolean;
}

/**
 * 滑动 seek 时的视觉反馈组件
 * 显示半透明提示层「快进 10s」/「快退 10s」
 */
export default function SeekFeedback({ direction, visible }: SeekFeedbackProps) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (visible && direction) {
      setShow(true);
    } else {
      const timer = setTimeout(() => setShow(false), 800);
      return () => clearTimeout(timer);
    }
  }, [visible, direction]);

  if (!show || !direction) return null;

  const label = direction === "right" ? "快进 10s" : "快退 10s";
  const icon = direction === "right" ? "»" : "«";

  return (
    <div className="seek-feedback">
      <div className="seek-feedback-icon">{icon}</div>
      <div className="seek-feedback-text">{label}</div>
    </div>
  );
}
