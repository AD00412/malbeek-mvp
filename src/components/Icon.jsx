/**
 * مجموعة أيقونات ملبّيك — خطّيّة (stroke) متّسقة، ترث اللون من المحيط.
 * الاستخدام: <Icon name="trips" size={20} />
 */
const PATHS = {
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></>,
  trips: <><path d="M4 16V7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9"/><path d="M3 16h18"/><circle cx="7.5" cy="19" r="1.5"/><circle cx="16.5" cy="19" r="1.5"/><path d="M8 5v11M16 5v11"/></>,
  customers: <><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M16 6.5a3 3 0 0 1 0 5.8"/><path d="M17.5 14.5a5.2 5.2 0 0 1 3 4.5"/></>,
  manifest: <><path d="M6 3h9l4 4v12.5A1.5 1.5 0 0 1 17.5 21h-11A1.5 1.5 0 0 1 5 19.5v-15A1.5 1.5 0 0 1 6 3z"/><path d="M14 3v4h4"/><path d="M8 12h8M8 15.5h8M8 8.5h3"/></>,
  barcode: <><path d="M3 5v14M6 5v14M9 5v10M9 17v2M12 5v14M16 5v14M19 5v14M21 5v14"/></>,
  payments: <><rect x="2.5" y="5.5" width="19" height="13" rx="2"/><path d="M2.5 9.5h19"/><path d="M6 14.5h4"/></>,
  share: <><circle cx="6" cy="12" r="2.4"/><circle cx="17" cy="5.5" r="2.4"/><circle cx="17" cy="18.5" r="2.4"/><path d="M8.1 10.9l6.8-4.1M8.1 13.1l6.8 4.1"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 13a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.2A1.6 1.6 0 0 0 6.8 19l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 5 13a1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.2A1.6 1.6 0 0 0 5 6.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 5V3a2 2 0 1 1 4 0v.2A1.6 1.6 0 0 0 17.2 5l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.6 1.6 0 0 0 21 11h.2a2 2 0 1 1 0 4H21a1.6 1.6 0 0 0-1.6 1z"/></>,
  building: <><rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2"/><path d="M10 21v-3h4v3"/></>,
  logout: <><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 12H3"/><path d="M6 8l-3 4 3 4"/></>,
  plus: <><path d="M12 5v14M5 12h14"/></>,
  edit: <><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z"/><path d="M13.5 6.5l3 3"/></>,
  trash: <><path d="M4 7h16M9 7V4.5h6V7M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/></>,
  menu: <><path d="M4 6h16M4 12h16M4 18h16"/></>,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></>,
  check: <><path d="M5 12l4.5 4.5L19 7"/></>,
  seat: <><path d="M6 4h8a2 2 0 0 1 2 2v7H6z"/><path d="M6 13v5M16 13v5M4 18h14"/><path d="M16 9h2.5A1.5 1.5 0 0 1 20 10.5V18"/></>,
  bell: <><path d="M6 8a6 6 0 1 1 12 0c0 6 2 7 2 7H4s2-1 2-7z"/><path d="M10.5 20a1.6 1.6 0 0 0 3 0"/></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/></>,
  location: <><path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z"/><circle cx="12" cy="9.5" r="2.5"/></>,
  search: <><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/></>,
  qr: <><rect x="3.5" y="3.5" width="6" height="6" rx="1"/><rect x="14.5" y="3.5" width="6" height="6" rx="1"/><rect x="3.5" y="14.5" width="6" height="6" rx="1"/><path d="M14 14h2v2h-2zM18 14h2.5M14 18.5h2M18.5 17v3.5"/></>,
  download: <><path d="M12 4v12"/><path d="M7 11l5 5 5-5"/><path d="M4 20h16"/></>,
  chart: <><path d="M4 19V5"/><path d="M4 19h16"/><path d="M8 16v-4M12 16V8M16 16v-7"/></>,
  sparkle: <><path d="M12 4v3M12 17v3M4 12h3M17 12h3"/><path d="M12 8.5a3.5 3.5 0 0 0 3.5 3.5A3.5 3.5 0 0 0 12 15.5 3.5 3.5 0 0 0 8.5 12 3.5 3.5 0 0 0 12 8.5z"/></>,
  bed: <><path d="M3 18V8"/><path d="M3 12h18v6"/><path d="M21 18v-4a2 2 0 0 0-2-2"/><circle cx="8" cy="11" r="2"/></>,
  badge: <><path d="M12 3l2.5 2 3.2-.4-.4 3.2 2 2.5-2 2.5.4 3.2-3.2-.4L12 18l-2.5-2-3.2.4.4-3.2L4.7 11l2-2.5-.4-3.2 3.2.4L12 3z"/><path d="M9.5 12l2 2 3-3"/></>,
  zap: <><path d="M13 3L4 13h6l-1 8 9-10h-6l1-8z"/></>,
  bus: <><rect x="3" y="5" width="18" height="12" rx="2"/><path d="M3 11h18M7 5v12M17 5v12"/><circle cx="7.5" cy="20" r="1.5"/><circle cx="16.5" cy="20" r="1.5"/></>,
  message: <><path d="M21 12a8 8 0 0 1-11.7 7.1L4 21l1.9-5.3A8 8 0 1 1 21 12z"/></>,
  chevron: <><path d="M9 6l6 6-6 6"/></>,
  arrowLeft: <><path d="M15 6l-6 6 6 6"/></>,
  arrowRight: <><path d="M9 6l6 6-6 6"/></>,
  filter: <><path d="M4 5h16l-6 8v6l-4-2v-4z"/></>,
  refresh: <><path d="M3 12a9 9 0 0 1 15.5-6.3L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.3L3 16"/><path d="M3 21v-5h5"/></>,
  external: <><path d="M14 3h7v7"/><path d="M21 3l-9 9"/><path d="M19 14v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6"/></>,
  rocket: <><path d="M14 4c5 2 6 8 6 8s-6-1-8-6"/><path d="M8 14s-3 1-4 4c3-1 4-4 4-4z"/><path d="M14 10l-6 6 4 4 6-6"/><circle cx="15.5" cy="8.5" r="1.5"/></>,
  user: <><circle cx="12" cy="8" r="3.6"/><path d="M5 20a7 7 0 0 1 14 0"/></>,
  phone: <><path d="M6.5 3h3l1.5 5-2 1.5a12 12 0 0 0 5.5 5.5l1.5-2 5 1.5v3a2 2 0 0 1-2.2 2A17 17 0 0 1 4.5 5.2 2 2 0 0 1 6.5 3z"/></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M4 7l8 6 8-6"/></>,
  lock: <><rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/><circle cx="12" cy="15.5" r="1.3"/></>,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></>,
  eyeOff: <><path d="M9.5 5.8A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-3.3 3.9M6 7.3A15.6 15.6 0 0 0 2.5 12S6 18.5 12 18.5a9.4 9.4 0 0 0 3.9-.8"/><path d="M10 10a3 3 0 0 0 4 4"/><path d="M3 3l18 18"/></>,
}

export default function Icon({ name, size = 20, className = '', strokeWidth = 1.7 }) {
  const p = PATHS[name]
  if (!p) return null
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {p}
    </svg>
  )
}
