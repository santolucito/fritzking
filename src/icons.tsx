const PATHS: Record<string, string> = {
  new: 'M6 3h8l5 5v13H6z M14 3v5h5',
  open: 'M3 7h6l2 2h10v10H3z',
  save: 'M5 3h12l3 3v15H5z M8 3v5h8V3 M8 21v-7h9v7',
  export: 'M12 3v12 M7 8l5-5 5 5 M4 15v6h16v-6',
  undo: 'M9 7L4 12l5 5 M4 12h11a5 5 0 0 1 0 10h-3',
  redo: 'M15 7l5 5-5 5 M20 12H9a5 5 0 0 0 0 10h3',
  rotate: 'M20 12a8 8 0 1 1-2.34-5.66 M20 4v5h-5',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 14h10l1-14',
  play: 'M7 4l13 8-13 8z',
  stop: 'M6 6h12v12H6z',
  bb: 'M3 6h18v12H3z M6 9h.01 M9 9h.01 M12 9h.01 M15 9h.01 M18 9h.01 M6 15h.01 M9 15h.01 M12 15h.01 M15 15h.01 M18 15h.01',
  sch: 'M2 12h4l2-4 3 8 3-8 2 4h6',
  examples: 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z',
  label: 'M3 7h11l5 5-5 5H3z M7 12h.01',
  route: 'M4 4h4v4H4z M16 16h4v4h-4z M8 6h6v10h2',
  help: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7 M12 17h.01',
};

export function Icon({ name }: { name: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={PATHS[name]} />
    </svg>
  );
}
