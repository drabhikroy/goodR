// Inline stroke icons. They take their color from the surrounding text, so
// every palette and appearance applies to them automatically. Status icons
// differ in shape as well as color: a check, a ring, a triangle, a square.

import type { ReactNode } from "react";

type IconProps = { size?: number; label?: string; className?: string };

function Svg({ size = 16, label, className, children, viewBox = "0 0 16 16" }: IconProps & { children: ReactNode; viewBox?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const CheckIcon = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="8" cy="8" r="7" fill="var(--ok)" stroke="none" />
    <path d="M4.8 8.2l2.2 2.2 4.2-4.6" stroke="var(--surface)" strokeWidth="1.8" />
  </Svg>
);

export const RingIcon = (props: IconProps) => (
  <Svg {...props} className={`spin ${props.className ?? ""}`}>
    <circle cx="8" cy="8" r="6" stroke="var(--border)" strokeWidth="2.4" />
    <path d="M8 2a6 6 0 0 1 6 6" stroke="var(--accent)" strokeWidth="2.4" />
  </Svg>
);

export const TriangleIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M8 1.2l7 12.6H1z" fill="var(--danger)" stroke="none" />
    <path d="M8 5.6v3.8" stroke="var(--surface)" strokeWidth="1.7" />
    <circle cx="8" cy="11.4" r="1" fill="var(--surface)" stroke="none" />
  </Svg>
);

export const WarnIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M8 1.5l6.5 3.5v6L8 14.5 1.5 11V5z" stroke="var(--warn)" />
    <path d="M1.5 5L8 8.5 14.5 5M8 8.5v6" stroke="var(--warn)" />
  </Svg>
);

/** A warning: a circle with an exclamation point, in the warning color, so
 * its shape differs from the triangle that marks an error. */
export const AlertIcon = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="8" cy="8" r="6.6" fill="var(--warn)" stroke="none" />
    <path d="M8 4.4v4.4" stroke="var(--surface)" strokeWidth="1.7" />
    <circle cx="8" cy="11.3" r="1" fill="var(--surface)" stroke="none" />
  </Svg>
);

export const StopIcon = (props: IconProps) => (
  <Svg {...props}>
    <rect x="3.5" y="3.5" width="9" height="9" rx="1.8" fill="currentColor" stroke="none" />
  </Svg>
);

export const PlayIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M4.5 2.5v11l9-5.5z" fill="currentColor" stroke="none" />
  </Svg>
);

export const PauseIcon = (props: IconProps) => (
  <Svg {...props}>
    <rect x="4" y="3" width="2.6" height="10" rx="0.8" />
    <rect x="9.4" y="3" width="2.6" height="10" rx="0.8" />
  </Svg>
);

export const HollowIcon = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="8" cy="8" r="6" strokeDasharray="2.4 2.4" />
  </Svg>
);

export const HomeIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M2 7.3 8 2.3l6 5" />
    <path d="M3.3 6.3V14h9.4V6.3" />
    <path d="M6.3 14v-4.3h3.4V14" />
  </Svg>
);

export const FolderIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M1.5 4h4.5l1.5 1.8h7v7.7h-13z" />
  </Svg>
);

export const FileIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M3.5 1.5h5.5l3.5 3.5v9.5h-9z" />
    <path d="M9 1.5v3.5h3.5" />
  </Svg>
);

export const ChevronIcon = ({ open, ...props }: IconProps & { open?: boolean }) => (
  <Svg {...props}>
    <path d={open ? "M4 6l4 4 4-4" : "M6 4l4 4-4 4"} />
  </Svg>
);

export const SearchIcon = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="7" cy="7" r="4.8" />
    <path d="M10.6 10.6L14 14" />
  </Svg>
);

export const PlusIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M8 3v10M3 8h10" />
  </Svg>
);

export const CloseIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Svg>
);

export const RestartIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5v3h-3" />
  </Svg>
);

/** A pencil, for changing something. */
export const PencilIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M10.5 2.5l3 3L5.5 13.5H2.5v-3z" />
    <path d="M9 4l3 3" />
  </Svg>
);

/** Undo: an arrow curving back to the left. */
export const UndoIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M5.5 3.5L2.5 6.5l3 3" />
    <path d="M2.8 6.5H10a3.5 3.5 0 0 1 0 7H7" />
  </Svg>
);

export const SaveIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M8 2v8M5 7l3 3 3-3M2.5 11v2.5h11V11" />
  </Svg>
);

export const ArrowIcon = ({ direction, ...props }: IconProps & { direction: "left" | "right" }) => (
  <Svg {...props}>
    <path d={direction === "left" ? "M10 3.5L5.5 8l4.5 4.5" : "M6 3.5L10.5 8 6 12.5"} />
  </Svg>
);

export const TableIcon = (props: IconProps) => (
  <Svg {...props}>
    <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
    <path d="M1.5 6.5h13M6 2.5v11" />
  </Svg>
);

export const ModelIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M2 13.5L14 3" />
    <circle cx="4" cy="10" r="1.2" />
    <circle cx="8" cy="8.3" r="1.2" />
    <circle cx="12" cy="4.8" r="1.2" />
  </Svg>
);

export const FunctionIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M10.5 2.5c-2 0-2.5 1-2.8 3l-1 6c-.3 1.6-.8 2-2.2 2M5 6.5h5" />
  </Svg>
);

export const ValueIcon = (props: IconProps) => (
  <Svg {...props}>
    <rect x="2.5" y="4.5" width="11" height="7" rx="1.5" />
    <path d="M5.5 8h5" />
  </Svg>
);

export const LayoutIcon = ({ layout, ...props }: IconProps & { layout: "inline" | "side" | "stacked" }) => (
  <Svg {...props} size={props.size ?? 20} viewBox="0 0 20 16">
    <rect x="1" y="1" width="18" height="14" rx="2" />
    {layout === "inline" && (
      <>
        <path d="M4 4.5h9M4 7h6" />
        <rect x="4" y="9" width="10" height="3.5" rx="0.8" fill="currentColor" stroke="none" />
      </>
    )}
    {layout === "side" && (
      <>
        <path d="M10 1v14" />
        <rect x="11.5" y="3" width="6" height="10" rx="0.8" fill="currentColor" stroke="none" />
      </>
    )}
    {layout === "stacked" && (
      <>
        <path d="M1 8h18" />
        <rect x="3" y="9.5" width="14" height="4" rx="0.8" fill="currentColor" stroke="none" />
      </>
    )}
  </Svg>
);

export const PackageIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M8 1.5l6.5 3.5v6L8 14.5 1.5 11V5z" />
    <path d="M1.5 5L8 8.5 14.5 5M8 8.5v6" />
  </Svg>
);

export const ReportIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M4 1.5h5.5L13 5v9.5H4z" />
    <path d="M6.5 8h4M6.5 10.5h4M6.5 13h2.5" />
  </Svg>
);

export const AppWindowIcon = (props: IconProps) => (
  <Svg {...props}>
    <rect x="1.5" y="2.5" width="13" height="9" rx="1.5" />
    <path d="M5.5 14h5M4.5 8.5l2-2 2 2 3-3" />
  </Svg>
);

export const ChartIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M2 14h12M4 12V8M7.5 12V4M11 12V7" />
  </Svg>
);

export const SidebarIcon = (props: IconProps) => (
  <Svg {...props}>
    <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
    <path d="M6 2.5v11" />
  </Svg>
);

/** A window with its right column marked, for the side panel. */
export const PanelIcon = (props: IconProps) => (
  <Svg {...props}>
    <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
    <path d="M10 2.5v11" />
  </Svg>
);

/** Arrows out to two corners, for showing something full size. */
export const ExpandIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9" />
  </Svg>
);

/** A pin, for keeping an output on the stage. */
export const PinIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M6 2.5h4M7 2.5v4L4.5 9h7L9 6.5v-4M8 9v4.5" />
  </Svg>
);

/** A prompt: the mark for code going in. */
export const CodeIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M3 4.5 6.5 8 3 11.5M8 11.5h5" />
  </Svg>
);

/** An arrow turning down and right: the mark for a result coming out. */
export const ResultIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M4 3v5.5a2 2 0 0 0 2 2h6.5M10 8l2.5 2.5L10 13" />
  </Svg>
);

export const CopyIcon = (props: IconProps) => (
  <Svg {...props}>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
    <path d="M10.5 3.5v-.5A1.5 1.5 0 0 0 9 1.5H4A1.5 1.5 0 0 0 2.5 3v5A1.5 1.5 0 0 0 4 9.5h.5" />
  </Svg>
);

/** An eye, open or struck through, for showing and hiding a result. */
export const EyeIcon = ({ closed = false, ...props }: IconProps & { closed?: boolean }) => (
  <Svg {...props}>
    <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" />
    <circle cx="8" cy="8" r="2" />
    {closed && <path d="M2.5 13.5 13.5 2.5" />}
  </Svg>
);

export const HelpIcon = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="8" cy="8" r="6.5" />
    <path d="M6.2 6.2a1.9 1.9 0 1 1 2.6 1.75c-.5.22-.8.6-.8 1.15v.4M8 11.6v.1" />
  </Svg>
);

export const MoreIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M3.5 8h.01M8 8h.01M12.5 8h.01" strokeWidth="2.4" />
  </Svg>
);

export const HistoryIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.5v2.2h2.2M8 5v3.2l2 1.3" />
  </Svg>
);

export const ImportIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M8 2v8M5 7l3 3 3-3M2.5 11v1.5A1.5 1.5 0 0 0 4 14h8a1.5 1.5 0 0 0 1.5-1.5V11" />
  </Svg>
);

export const BroomIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M13.5 2.5 8.5 7.5M6.5 7l3 3-1.2 3.5c-2.3-.4-4.7-2.8-5.3-5.3L6.5 7Z" />
  </Svg>
);

// A four point star, the usual sign for help from a language model, kept
// plain so it does not compete with the run and status shapes.
export const SparkIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M8 1Q8.9 7.1 15 8Q8.9 8.9 8 15Q7.1 8.9 1 8Q7.1 7.1 8 1Z" fill="currentColor" stroke="none" />
  </Svg>
);
