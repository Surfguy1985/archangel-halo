import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef, type CSSProperties, type ReactNode } from "react";

const DEFAULT_THRESHOLD = 50;

export type VirtualListProps<T> = {
  items: T[];
  estimateSize: number;
  renderItem: (item: T, index: number) => ReactNode;
  getKey?: (item: T, index: number) => string;
  threshold?: number;
  overscan?: number;
  maxHeight?: number;
  gap?: number;
  style?: CSSProperties;
};

/** Window lists over `threshold` rows. Shorter lists render in full (no shift). */
export function VirtualList<T>(props: VirtualListProps<T>) {
  const threshold = props.threshold ?? DEFAULT_THRESHOLD;
  const parentRef = useRef<HTMLDivElement>(null);
  const gap = props.gap ?? 0;
  const virtualize = props.items.length > threshold;
  const virtualizer = useVirtualizer({
    count: props.items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => props.estimateSize + gap,
    overscan: props.overscan ?? 6,
    enabled: virtualize,
  });

  if (!virtualize) {
    return (
      <div style={props.style}>
        {props.items.map((item, index) => (
          <div key={props.getKey?.(item, index) ?? index}>{props.renderItem(item, index)}</div>
        ))}
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      style={{
        ...props.style,
        overflow: "auto",
        maxHeight: props.maxHeight ?? 640,
      }}
    >
      <div
        style={{
          height: virtualizer.getTotalSize(),
          width: "100%",
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((row) => {
          const item = props.items[row.index];
          if (item === undefined) return null;
          return (
            <div
              key={props.getKey?.(item, row.index) ?? row.key}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: row.size,
                transform: `translateY(${row.start}px)`,
              }}
            >
              {props.renderItem(item, row.index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export type VirtualGridProps<T> = {
  items: T[];
  columnWidth: number;
  rowHeight: number;
  gap?: number;
  renderItem: (item: T, index: number) => ReactNode;
  getKey?: (item: T, index: number) => string;
  threshold?: number;
  maxHeight?: number;
  style?: CSSProperties;
};

export function VirtualGrid<T>(props: VirtualGridProps<T>) {
  const threshold = props.threshold ?? DEFAULT_THRESHOLD;
  const gap = props.gap ?? 12;
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualize = props.items.length > threshold;
  const columns = Math.max(
    1,
    Math.floor(((parentRef.current?.clientWidth ?? 960) + gap) / (props.columnWidth + gap)),
  );
  const rowCount = Math.ceil(props.items.length / columns);
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => props.rowHeight + gap,
    overscan: 4,
    enabled: virtualize,
  });

  const gridStyle: CSSProperties = {
    display: "grid",
    gridTemplateColumns: `repeat(auto-fill, minmax(${props.columnWidth}px, 1fr))`,
    gap,
    ...props.style,
  };

  if (!virtualize) {
    return (
      <div style={gridStyle}>
        {props.items.map((item, index) => (
          <div key={props.getKey?.(item, index) ?? index}>{props.renderItem(item, index)}</div>
        ))}
      </div>
    );
  }

  return (
    <div ref={parentRef} style={{ overflow: "auto", maxHeight: props.maxHeight ?? 720 }}>
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((row) => {
          const start = row.index * columns;
          const slice = props.items.slice(start, start + columns);
          return (
            <div
              key={row.key}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${row.start}px)`,
                display: "grid",
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                gap,
              }}
            >
              {slice.map((item, i) => (
                <div key={props.getKey?.(item, start + i) ?? start + i}>
                  {props.renderItem(item, start + i)}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
