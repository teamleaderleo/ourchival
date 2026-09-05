"use client";
import { Children, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export function Masonry({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(4);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = () => setCount(Math.max(2, Math.floor(element.clientWidth / 250)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const columns: ReactNode[][] = Array.from({ length: count }, () => []);
  // Append-only placement keeps existing cards in their columns as pages arrive.
  Children.toArray(children).forEach((child, index) => columns[index % count]!.push(child));
  return <div ref={root} className="masonry">
    {columns.map((column, index) => <div className="masonry-column" key={index}>{column}</div>)}
  </div>;
}
