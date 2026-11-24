const Svg = ({ children, size = 16, className = '', strokeWidth = 1.7, ...rest }) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    {...rest}
  >
    {children}
  </svg>
);

export const Dashboard = (p) => <Svg {...p}><rect x="3" y="3" width="7.5" height="8.5" rx="1.6" /><rect x="13.5" y="3" width="7.5" height="5.5" rx="1.6" /><rect x="13.5" y="11.5" width="7.5" height="9.5" rx="1.6" /><rect x="3" y="14.5" width="7.5" height="6.5" rx="1.6" /></Svg>;
export const Globe = (p) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.4 4 5.6 4 9s-1.5 6.6-4 9c-2.5-2.4-4-5.6-4-9s1.5-6.6 4-9z" /></Svg>;
export const Search = (p) => <Svg {...p}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></Svg>;
export const Chart = (p) => <Svg {...p}><path d="M4 19V5M4 19h16" /><path d="m7 15 3.5-4.5 3 2.5L20 7" /></Svg>;
export const Sparkles = (p) => <Svg {...p}><path d="M12 3.5 13.6 8 18 9.6 13.6 11.2 12 15.8 10.4 11.2 6 9.6 10.4 8 12 3.5z" /><path d="M18.5 15.5 19.3 18l2.2.8-2.2.8-.8 2.4-.8-2.4-2.2-.8 2.2-.8.8-2.5z" /></Svg>;
export const PenTool = (p) => <Svg {...p}><path d="m12 3 6 6-7.5 7.5L4 18l1.5-6.5L12 3z" /><path d="m10 12 2 2" /></Svg>;
export const Megaphone = (p) => <Svg {...p}><path d="M4 10v4a1 1 0 0 0 1 1h2l4 3.5V5.5L7 9H5a1 1 0 0 0-1 1z" /><path d="M15 9a4 4 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11" /></Svg>;
export const ClipboardCheck = (p) => <Svg {...p}><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V2.8h6V4" /><path d="m8.5 13 2 2 4-4.5" /></Svg>;
export const FileText = (p) => <Svg {...p}><path d="M6 3h8l4 4v14H6V3z" /><path d="M14 3v4h4M9 12h6M9 16h6" /></Svg>;
export const Clock = (p) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></Svg>;
export const Plug = (p) => <Svg {...p}><path d="M9 3v6M15 3v6" /><path d="M6 9h12v3a6 6 0 0 1-12 0V9z" /><path d="M12 18v3" /></Svg>;
export const Settings = (p) => <Svg {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.51 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.14.37.5.7.9.85.3.12.66.18 1.1.18a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z" /></Svg>;
export const Check = (p) => <Svg {...p}><path d="m4.5 12.5 5 5 10-11" /></Svg>;
export const CheckCircle = (p) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="m8 12.5 2.5 2.5L16 9.5" /></Svg>;
export const Alert = (p) => <Svg {...p}><path d="M12 4 2.8 20h18.4L12 4z" /><path d="M12 10v4M12 17.5v.01" /></Svg>;
export const AlertCircle = (p) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 8v4.5M12 16v.01" /></Svg>;
export const Info = (p) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8v.01" /></Svg>;
export const X = (p) => <Svg {...p}><path d="M6 6l12 12M18 6 6 18" /></Svg>;
export const Plus = (p) => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>;
export const Trash = (p) => <Svg {...p}><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v5M14 11v5" /></Svg>;
export const Download = (p) => <Svg {...p}><path d="M12 4v10m0 0 4-4m-4 4-4-4M5 19h14" /></Svg>;
export const Upload = (p) => <Svg {...p}><path d="M12 20V10m0 0 4 4m-4-4-4 4M5 5h14" /></Svg>;
export const External = (p) => <Svg {...p}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></Svg>;
export const Refresh = (p) => <Svg {...p}><path d="M4 12a8 8 0 0 1 13.6-5.6L20 8" /><path d="M20 4v4h-4" /><path d="M20 12a8 8 0 0 1-13.6 5.6L4 16" /><path d="M4 20v-4h4" /></Svg>;
export const Play = (p) => <Svg {...p}><path d="M8 5.5v13l11-6.5L8 5.5z" /></Svg>;
export const Pause = (p) => <Svg {...p}><rect x="7" y="5" width="3.5" height="14" rx="1" /><rect x="13.5" y="5" width="3.5" height="14" rx="1" /></Svg>;
export const ChevronRight = (p) => <Svg {...p}><path d="m9 5 7 7-7 7" /></Svg>;
export const ChevronLeft = (p) => <Svg {...p}><path d="m15 5-7 7 7 7" /></Svg>;
export const ChevronDown = (p) => <Svg {...p}><path d="m5 9 7 7 7-7" /></Svg>;
export const ArrowUp = (p) => <Svg {...p}><path d="M12 19V5m0 0 6 6m-6-6-6 6" /></Svg>;
export const ArrowDown = (p) => <Svg {...p}><path d="M12 5v14m0 0 6-6m-6 6-6-6" /></Svg>;
export const ArrowUpRight = (p) => <Svg {...p}><path d="M7 17 17 7M9 7h8v8" /></Svg>;
export const Trend = (p) => <Svg {...p}><path d="m3 17 5-5 3.5 3L21 6" /><path d="M15 6h6v6" /></Svg>;
export const MousePointer = (p) => <Svg {...p}><path d="m5 3 14 7-6 2-2 6L5 3z" /></Svg>;
export const Eye = (p) => <Svg {...p}><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" /><circle cx="12" cy="12" r="2.7" /></Svg>;
export const Target = (p) => <Svg {...p}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" /></Svg>;
export const Link2 = (p) => <Svg {...p}><path d="M9.5 14.5 14.5 9.5" /><path d="M11 6.5 12.5 5a4 4 0 1 1 6 6L17 12.5" /><path d="M13 17.5 11.5 19a4 4 0 1 1-6-6L7 11.5" /></Svg>;
export const LinkIcon = (p) => <Svg {...p}><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5" /><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5" /></Svg>;
export const Image = (p) => <Svg {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9.5" r="1.5" /><path d="m4 17 5-5 4 4 2-2 5 4" /></Svg>;
export const Code = (p) => <Svg {...p}><path d="m8 8-5 4 5 4M16 8l5 4-5 4M13.5 5l-3 14" /></Svg>;
export const Layers = (p) => <Svg {...p}><path d="m12 3 9 5-9 5-9-5 9-5z" /><path d="m3 13 9 5 9-5" /></Svg>;
export const User = (p) => <Svg {...p}><circle cx="12" cy="8" r="3.5" /><path d="M5 20c0-3.4 3.1-5.5 7-5.5s7 2.1 7 5.5" /></Svg>;
export const LogOut = (p) => <Svg {...p}><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 8l-4 4 4 4M6 12h9" /></Svg>;
export const Shield = (p) => <Svg {...p}><path d="M12 3l8 3v6c0 5-3.4 8.2-8 9-4.6-.8-8-4-8-9V6l8-3z" /><path d="m8.5 12 2.3 2.3 4.7-5" /></Svg>;
export const Lock = (p) => <Svg {...p}><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></Svg>;
export const Mail = (p) => <Svg {...p}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3.5 6.5 8.5 6 8.5-6" /></Svg>;
export const Calendar = (p) => <Svg {...p}><rect x="3.5" y="5" width="17" height="16" rx="2" /><path d="M8 3v4M16 3v4M3.5 10h17" /></Svg>;
export const Server = (p) => <Svg {...p}><rect x="3" y="4" width="18" height="7" rx="2" /><rect x="3" y="13" width="18" height="7" rx="2" /><path d="M7 7.5h.01M7 16.5h.01" /></Svg>;
export const Activity = (p) => <Svg {...p}><path d="M3 12h3l2.5-7 4 14 2.5-7H21" /></Svg>;
export const Filter = (p) => <Svg {...p}><path d="M4 5h16l-6 8v6l-4-2v-4L4 5z" /></Svg>;
export const Copy = (p) => <Svg {...p}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a1 1 0 0 1 1-1h10" /></Svg>;
export const Sort = (p) => <Svg {...p}><path d="M8 4v16m0 0-4-4m4 4 4-4M16 20V4m0 0-4 4m4-4 4 4" /></Svg>;
export const List = (p) => <Svg {...p}><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" /></Svg>;
export const Sun = (p) => <Svg {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></Svg>;
export const Moon = (p) => <Svg {...p}><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5z" /></Svg>;
export const Building = (p) => <Svg {...p}><rect x="4" y="4" width="16" height="17" rx="1.5" /><path d="M9 8h.01M15 8h.01M9 12h.01M15 12h.01M9 16h.01M15 16h.01" /></Svg>;
export const Rocket = (p) => <Svg {...p}><path d="M12 3c3.5 1.5 5.5 4.5 5.5 8 0 2-.6 3.6-1.4 5H7.9A11.7 11.7 0 0 1 6.5 11C6.5 7.5 8.5 4.5 12 3z" /><path d="M9.5 16 8 21l4-2 4 2-1.5-5" /><circle cx="12" cy="9" r="1.6" /></Svg>;
export const Gauge = (p) => <Svg {...p}><path d="M4 18a8 8 0 1 1 16 0" /><path d="m12 14 4-4" /><circle cx="12" cy="18" r="1.2" /></Svg>;
export const Compass = (p) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5 5-2z" /></Svg>;
export const Sitemap = (p) => <Svg {...p}><rect x="9" y="3" width="6" height="5" rx="1" /><rect x="3" y="16" width="6" height="5" rx="1" /><rect x="15" y="16" width="6" height="5" rx="1" /><path d="M12 8v4M6 16v-4h12v4" /></Svg>;
export const Menu = (p) => <Svg {...p}><path d="M4 6h16M4 12h16M4 18h16" /></Svg>;
export const Inbox = (p) => <Svg {...p}><path d="M4 13h4l1.5 2.5h5L16 13h4" /><path d="M4 13 6 5h12l2 8v5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18v-5z" /></Svg>;
export const Users = (p) => <Svg {...p}><circle cx="9" cy="8" r="3.2" /><path d="M3 19c0-3 2.7-4.8 6-4.8s6 1.8 6 4.8" /><path d="M16 5.6a3.2 3.2 0 0 1 0 6.3M17.5 14.6c2.2.4 3.5 1.9 3.5 4.4" /></Svg>;
export const Timer = (p) => <Svg {...p}><circle cx="12" cy="13" r="8" /><path d="M12 9.5V13l2.5 1.5M9.5 2.5h5" /></Svg>;
