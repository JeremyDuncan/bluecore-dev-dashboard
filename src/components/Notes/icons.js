// Small line icons for the Notes page buttons (same stroke style as the navbar icons)
import React from 'react';

function Svg({size = 16, children}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

export const CopyIcon = (p) => (
  <Svg {...p}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </Svg>
);

// Two sheets with a plus: a copy of the note
export const DuplicateIcon = (p) => (
  <Svg {...p}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1M15 12v6M12 15h6" />
  </Svg>
);

export const DownloadIcon = (p) => (
  <Svg {...p}>
    <path d="M12 3v12M7 10l5 5 5-5" />
    <path d="M5 21h14" />
  </Svg>
);

export const CheckIcon = (p) => (
  <Svg {...p}>
    <path d="M20 6 9 17l-5-5" />
  </Svg>
);

export const TrashIcon = (p) => (
  <Svg {...p}>
    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
  </Svg>
);

export const PlusIcon = (p) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const EditIcon = (p) => (
  <Svg {...p}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
  </Svg>
);

export const XIcon = (p) => (
  <Svg {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Svg>
);

export const TagIcon = (p) => (
  <Svg {...p}>
    <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" />
    <circle cx="7.5" cy="7.5" r="1.2" fill="currentColor" />
  </Svg>
);

export const FolderIcon = (p) => (
  <Svg {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </Svg>
);

export const FolderOpenIcon = (p) => (
  <Svg {...p}>
    <path d="M3 17V7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v1" />
    <path d="M3 17l2.4-6.2A1.5 1.5 0 0 1 6.8 10H21l-2.6 7.3A2.5 2.5 0 0 1 16 19H5a2 2 0 0 1-2-2z" />
  </Svg>
);

export const NoteIcon = (p) => (
  <Svg {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5M9 13h6M9 17h4" />
  </Svg>
);

export const ChevronIcon = (p) => (
  <Svg {...p}>
    <path d="m9 6 6 6-6 6" />
  </Svg>
);

export const ArrowLeftIcon = (p) => (
  <Svg {...p}>
    <path d="M19 12H5M11 18l-6-6 6-6" />
  </Svg>
);

export const CalendarIcon = (p) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M16 3v4M8 3v4M3 11h18" />
  </Svg>
);

export const ClockIcon = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Svg>
);

export const UserIcon = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </Svg>
);

export const TextIcon = (p) => (
  <Svg {...p}>
    <path d="M4 6h16M4 12h16M4 18h10" />
  </Svg>
);

export const SearchIcon = (p) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Svg>
);

export const EyeIcon = (p) => (
  <Svg {...p}>
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
);

export const LinkIcon = (p) => (
  <Svg {...p}>
    <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
    <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
  </Svg>
);

export const SelectIcon = (p) => (
  <Svg {...p}>
    <rect x="3" y="3" width="18" height="18" rx="3" />
    <path d="m8 12 3 3 5-6" />
  </Svg>
);

export const HelpIcon = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="10" />
    <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01" />
  </Svg>
);

export const SparkleIcon = (p) => (
  <Svg {...p}>
    <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
    <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
  </Svg>
);

export const PlugIcon = (p) => (
  <Svg {...p}>
    <path d="M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0zM12 17v5" />
  </Svg>
);

// Obsidian's mark, simplified: a faceted crystal
export const ObsidianIcon = (p) => (
  <Svg {...p}>
    <path d="M8.5 2.5 16 4.5l3.5 7-3 9.5-8.5-2-4-6.5z" />
    <path d="M8.5 2.5 10 12l6.5 9M10 12l9.5-0.5M10 12l-6 1" />
  </Svg>
);

// --- Markdown toolbar ---

export const HeadingIcon = (p) => (
  <Svg {...p}>
    <path d="M6 4v16M18 4v16M6 12h12" />
  </Svg>
);

export const BoldIcon = (p) => (
  <Svg {...p}>
    <path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z" />
  </Svg>
);

export const ItalicIcon = (p) => (
  <Svg {...p}>
    <path d="M19 4h-9M14 20H5M15 4 9 20" />
  </Svg>
);

export const StrikeIcon = (p) => (
  <Svg {...p}>
    <path d="M16 5H10a3 3 0 0 0-2.6 4.5M14 12a3.5 3.5 0 0 1-1 7H7M4 12h16" />
  </Svg>
);

export const CodeIcon = (p) => (
  <Svg {...p}>
    <path d="m16 18 6-6-6-6M8 6l-6 6 6 6" />
  </Svg>
);

export const CodeBlockIcon = (p) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="m10 10-2 2 2 2M14 10l2 2-2 2" />
  </Svg>
);

// [[ ]]: a link to another note
export const NoteLinkIcon = (p) => (
  <Svg {...p}>
    <path d="M7 4H4v16h3M10 4H8.5M17 4h3v16h-3M14 4h1.5M10 20H8.5M14 20h1.5M9 12h6" />
  </Svg>
);

export const ListIcon = (p) => (
  <Svg {...p}>
    <path d="M9 6h11M9 12h11M9 18h11" />
    <circle cx="4.5" cy="6" r="1" fill="currentColor" />
    <circle cx="4.5" cy="12" r="1" fill="currentColor" />
    <circle cx="4.5" cy="18" r="1" fill="currentColor" />
  </Svg>
);

export const OrderedListIcon = (p) => (
  <Svg {...p}>
    <path d="M10 6h10M10 12h10M10 18h10M4 4h1.5v4M4 8h3M4 14.5a1.5 1.5 0 0 1 3 0c0 1-3 2-3 3.5h3" />
  </Svg>
);

export const TaskIcon = (p) => (
  <Svg {...p}>
    <rect x="3" y="5" width="6" height="6" rx="1" />
    <path d="m3.5 17 2 2 3.5-4M13 8h8M13 17h8" />
  </Svg>
);

export const QuoteIcon = (p) => (
  <Svg {...p}>
    <path d="M4 6v12M9 8h11M9 12h11M9 16h7" />
  </Svg>
);

export const CalloutIcon = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 16v-4M12 8h.01" />
  </Svg>
);

export const TableIcon = (p) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 10h18M3 15h18M10 4v16" />
  </Svg>
);

export const RuleIcon = (p) => (
  <Svg {...p}>
    <path d="M3 12h18" />
    <path d="M8 7h8M8 17h8" opacity="0.4" />
  </Svg>
);

export const ImageIcon = (p) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="9" cy="10" r="1.5" />
    <path d="m21 16-5-5-9 9" />
  </Svg>
);

export const MoreIcon = (p) => (
  <Svg {...p}>
    <circle cx="5" cy="12" r="1.3" fill="currentColor" />
    <circle cx="12" cy="12" r="1.3" fill="currentColor" />
    <circle cx="19" cy="12" r="1.3" fill="currentColor" />
  </Svg>
);

export const BookIcon = (p) => (
  <Svg {...p}>
    <path d="M4 19.5V5a2 2 0 0 1 2-2h14v16H6.5A2.5 2.5 0 0 0 4 21.5 2.5 2.5 0 0 0 6.5 24" transform="translate(0 -1.5)" />
    <path d="M8 7h8M8 11h6" />
  </Svg>
);

export const PinIcon = (p) => (
  <Svg {...p}>
    <path d="M9 4h6l-1 6 3 3v2H7v-2l3-3z" />
    <path d="M12 15v6" />
  </Svg>
);

export const LayoutIcon = (p) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M12 4v16" />
  </Svg>
);

export const TemplateIcon = (p) => (
  <Svg {...p}>
    <rect x="3" y="3" width="18" height="6" rx="1.5" />
    <rect x="3" y="12" width="8" height="9" rx="1.5" />
    <path d="M14 13h7M14 17h7M14 21h4" />
  </Svg>
);

// A panel with its left column: hide or show the notes list
export const PanelIcon = (p) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16" />
  </Svg>
);

// A notebook: a page with a code bracket (the Notebooks page)
export const NotebookIcon = (p) => (
  <Svg {...p}>
    <path d="M6 3h11a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6z" />
    <path d="M6 3v18M3 7h3M3 12h3M3 17h3" />
    <path d="M11.5 10l-2 2 2 2M14.5 10l2 2-2 2" />
  </Svg>
);
