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
