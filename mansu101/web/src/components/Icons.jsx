const Svg = ({ children, size = 16, className = '', strokeWidth = 1.8, ...rest }) => (
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

export const Play = (props) => (
  <Svg {...props}><path d="M7 5.5v13l11-6.5-11-6.5z" /></Svg>
);
export const Pause = (props) => (
  <Svg {...props}><rect x="7" y="5" width="3.5" height="14" rx="1" /><rect x="13.5" y="5" width="3.5" height="14" rx="1" /></Svg>
);
export const Stop = (props) => (
  <Svg {...props}><rect x="6.5" y="6.5" width="11" height="11" rx="1.5" /></Svg>
);
export const Restart = (props) => (
  <Svg {...props}><path d="M20 5v5h-5" /><path d="M20 10a8 8 0 1 0 1 4" /></Svg>
);
export const Plus = (props) => (
  <Svg {...props}><path d="M12 5v14M5 12h14" /></Svg>
);
export const Trash = (props) => (
  <Svg {...props}><path d="M4 7h16M9 7V5h6v2M6 7l1 12h10l1-12M10 11v4M14 11v4" /></Svg>
);
export const Download = (props) => (
  <Svg {...props}><path d="M12 4v10m0 0 4-4m-4 4-4-4M5 19h14" /></Svg>
);
export const X = (props) => (
  <Svg {...props}><path d="M6 6l12 12M18 6 6 18" /></Svg>
);
export const External = (props) => (
  <Svg {...props}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></Svg>
);
export const Refresh = (props) => (
  <Svg {...props}><path d="M4 12a8 8 0 0 1 13.6-5.6L20 8" /><path d="M20 4v4h-4" /><path d="M20 12a8 8 0 0 1-13.6 5.6L4 16" /><path d="M4 20v-4h4" /></Svg>
);
export const Lock = (props) => (
  <Svg {...props}><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></Svg>
);
export const LogOut = (props) => (
  <Svg {...props}><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 8l-4 4 4 4M6 12h9" /></Svg>
);
export const Activity = (props) => (
  <Svg {...props}><path d="M3 12h3l2.5-7 4 14 2.5-7H21" /></Svg>
);
export const Monitor = (props) => (
  <Svg {...props}><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></Svg>
);
export const Layers = (props) => (
  <Svg {...props}><path d="m12 3 9 5-9 5-9-5 9-5z" /><path d="m3 13 9 5 9-5" /></Svg>
);
export const Check = (props) => (
  <Svg {...props}><path d="m4.5 12.5 5 5 10-11" /></Svg>
);
export const Alert = (props) => (
  <Svg {...props}><path d="M12 4 2.8 20h18.4L12 4z" /><path d="M12 10v4M12 17.5v.01" /></Svg>
);
export const Server = (props) => (
  <Svg {...props}><rect x="3" y="4" width="18" height="7" rx="2" /><rect x="3" y="13" width="18" height="7" rx="2" /><path d="M7 7.5h.01M7 16.5h.01" /></Svg>
);
export const Cpu = (props) => (
  <Svg {...props}><rect x="6" y="6" width="12" height="12" rx="2" /><rect x="9.5" y="9.5" width="5" height="5" rx="1" /><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" /></Svg>
);
export const HardDrive = (props) => (
  <Svg {...props}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 12h.01M11 12h.01M3 14h18" /></Svg>
);
export const Memory = (props) => (
  <Svg {...props}><rect x="3" y="8" width="18" height="9" rx="1.5" /><path d="M7 8V5M11 8V5M15 8V5M19 8V5M7 17v2M11 17v2M15 17v2M19 17v2" /></Svg>
);
export const Globe = (props) => (
  <Svg {...props}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.4 4 5.6 4 9s-1.5 6.6-4 9c-2.5-2.4-4-5.6-4-9s1.5-6.6 4-9z" /></Svg>
);
export const Clock = (props) => (
  <Svg {...props}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></Svg>
);
export const ChevronRight = (props) => (
  <Svg {...props}><path d="m9 5 7 7-7 7" /></Svg>
);
export const ChevronDown = (props) => (
  <Svg {...props}><path d="m5 9 7 7 7-7" /></Svg>
);
export const Terminal = (props) => (
  <Svg {...props}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 9 3 3-3 3M13 15h4" /></Svg>
);
export const Settings = (props) => (
  <Svg {...props}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.51 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.14.37.5.7.9.85.3.12.66.18 1.1.18a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z" /></Svg>
);
export const List = (props) => (
  <Svg {...props}><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" /></Svg>
);
export const History = (props) => (
  <Svg {...props}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></Svg>
);
export const Shield = (props) => (
  <Svg {...props}><path d="M12 3l8 3v6c0 5-3.4 8.2-8 9-4.6-.8-8-4-8-9V6l8-3z" /><path d="m8.5 12 2.3 2.3 4.7-5" /></Svg>
);
export const Camera = (props) => (
  <Svg {...props}><path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" /><circle cx="12" cy="13" r="3.5" /></Svg>
);
export const Wifi = (props) => (
  <Svg {...props}><path d="M2 8.5a15 15 0 0 1 20 0M5 12a10.5 10.5 0 0 1 14 0M8.5 15.5a6 6 0 0 1 7 0" /><path d="M12 19h.01" /></Svg>
);
export const WifiOff = (props) => (
  <Svg {...props}><path d="M2 8.5a15 15 0 0 1 7-3.8M14.5 4.9a15 15 0 0 1 7.5 3.6M5 12a10.5 10.5 0 0 1 4-2.3M15.5 9.9a10.5 10.5 0 0 1 3.5 2.1M8.5 15.5a6 6 0 0 1 7 0M12 19h.01M3 3l18 18" /></Svg>
);
export const Zap = (props) => (
  <Svg {...props}><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" /></Svg>
);
export const Eye = (props) => (
  <Svg {...props}><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" /><circle cx="12" cy="12" r="2.7" /></Svg>
);
export const Copy = (props) => (
  <Svg {...props}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a1 1 0 0 1 1-1h10" /></Svg>
);
export const Filter = (props) => (
  <Svg {...props}><path d="M4 5h16l-6 8v6l-4-2v-4L4 5z" /></Svg>
);
export const Search = (props) => (
  <Svg {...props}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></Svg>
);
export const ArrowUpRight = (props) => (
  <Svg {...props}><path d="M7 17 17 7M9 7h8v8" /></Svg>
);
export const Save = (props) => (
  <Svg {...props}><path d="M5 4h11l3 3v13H5V4z" /><path d="M8 4v5h7V4M8 15h8" /></Svg>
);
export const Command = (props) => (
  <Svg {...props}><path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6z" /></Svg>
);
