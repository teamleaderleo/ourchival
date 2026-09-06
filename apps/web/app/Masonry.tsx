"use client";
import {
  Children,
  isValidElement,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { masonryWindow } from "./masonryWindow";

type CardProps = {
  reference?: {
    _id: string;
    assets: Array<{ width?: number; height?: number }>;
  };
};
type Card = { node: ReactNode; key: string; id?: string; estimate: number };
const gap = 8;

export function Masonry({
  children,
  restoreId,
}: {
  children: ReactNode;
  restoreId?: string | null;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);
  const [viewport, setViewport] = useState({ top: 0, height: 900 });
  const [heights, setHeights] = useState<Record<string, number>>({});
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const count = Math.max(2, Math.floor(width / 250));
  const columnWidth = (width - gap * (count - 1)) / count;
  const widthKey = Math.round(columnWidth);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      setWidth(element.clientWidth);
      setViewport({
        top: -element.getBoundingClientRect().top,
        height: window.innerHeight,
      });
    };
    const queue = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    const observer = new ResizeObserver(queue);
    observer.observe(element);
    window.addEventListener("scroll", queue, { passive: true });
    window.addEventListener("resize", queue);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", queue);
      window.removeEventListener("resize", queue);
    };
  }, []);
  const onHeight = useCallback((key: string, height: number) => {
    setHeights((previous) =>
      Math.abs((previous[key] ?? 0) - height) < 1
        ? previous
        : { ...previous, [key]: height },
    );
  }, []);
  const columns: Card[][] = Array.from({ length: count }, () => []);
  // Append-only placement keeps existing cards in their columns as pages arrive.
  Children.toArray(children).forEach((node, index) => {
    const element = isValidElement<CardProps>(node) ? node : null;
    const asset = element?.props.reference?.assets[0];
    const estimate =
      asset?.width && asset.height
        ? (columnWidth * asset.height) / asset.width + 8
        : 340;
    columns[index % count]!.push({
      node,
      id: element?.props.reference?._id,
      key: `${widthKey}:${element?.key ?? index}`,
      estimate,
    });
  });
  return (
    <div
      ref={root}
      className="masonry"
      onFocusCapture={(event) =>
        setFocusedId(
          (event.target as HTMLElement).closest<HTMLElement>(
            "[data-reference-id]",
          )?.dataset.referenceId ?? null,
        )
      }
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setFocusedId(null);
      }}
    >
      {columns.map((column, index) => {
        const windowed = masonryWindow(
          column.map((card) => (heights[card.key] ?? card.estimate) + gap),
          viewport.top,
          viewport.height,
        );
        const indices = new Set(
          Array.from(
            { length: windowed.end - windowed.start },
            (_, offset) => windowed.start + offset,
          ),
        );
        for (const id of [restoreId, focusedId]) {
          const pinned = id ? column.findIndex((card) => card.id === id) : -1;
          if (pinned >= 0) indices.add(pinned);
        }
        let previousEnd = 0;
        const slots = Array.from(indices)
          .sort((a, b) => a - b)
          .flatMap((slot) => {
            const card = column[slot]!;
            const before = windowed.offsets[slot]! - previousEnd;
            previousEnd = windowed.offsets[slot + 1]!;
            return [
              <div
                key={`space:${card.key}`}
                aria-hidden="true"
                style={{ height: before, flexShrink: 0 }}
              />,
              <MeasuredCard
                key={card.key}
                identity={card.key}
                onHeight={onHeight}
              >
                {card.node}
              </MeasuredCard>,
            ];
          });
        return (
          <div className="masonry-column" key={index} style={{ gap: 0 }}>
            {slots}
            <div
              aria-hidden="true"
              style={{
                height: Math.max(0, windowed.total - previousEnd),
                flexShrink: 0,
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

function MeasuredCard({
  identity,
  onHeight,
  children,
}: {
  identity: string;
  onHeight: (key: string, height: number) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () =>
      onHeight(identity, node.getBoundingClientRect().height - gap);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [identity, onHeight]);
  return (
    <div ref={ref} style={{ paddingBottom: gap }}>
      {children}
    </div>
  );
}
