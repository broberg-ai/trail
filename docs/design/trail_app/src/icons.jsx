// =====================================================================
// Trail — Lucide-style inline SVG icons (24x24 viewBox, stroke 1.75)
// =====================================================================

const Icon = ({ d, size = 16, stroke = 1.75, fill = "none", style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill}
    stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round"
    style={style} aria-hidden="true">
    {typeof d === 'string' ? <path d={d} /> : d}
  </svg>
);

const TrailLogo = ({ size = 28 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
    <circle cx="16" cy="16" r="14" fill="none" stroke="var(--logo-outer)" strokeWidth="2"/>
    <circle cx="16" cy="16" r="9" fill="none" stroke="var(--color-accent)" strokeWidth="0.9" opacity="0.55"/>
    <circle cx="16" cy="16" r="3.5" fill="var(--color-accent)"/>
  </svg>
);

const GoogleG = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true">
    <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/>
    <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.836.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z"/>
    <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
    <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
  </svg>
);

const Icons = {
  Logo: TrailLogo,
  Google: GoogleG,
  Search: (p) => <Icon {...p} d={<><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></>} />,
  Chevron: (p) => <Icon {...p} d="M6 9l6 6 6-6" />,
  ChevronRight: (p) => <Icon {...p} d="M9 6l6 6-6 6" />,
  Check: (p) => <Icon {...p} d="M20 6L9 17l-5-5" />,
  X: (p) => <Icon {...p} d="M18 6L6 18M6 6l12 12" />,
  Plus: (p) => <Icon {...p} d="M12 5v14M5 12h14" />,
  Sun: (p) => <Icon {...p} d={<><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></>} />,
  Moon: (p) => <Icon {...p} d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" />,
  Monitor: (p) => <Icon {...p} d={<><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></>} />,
  Volume: (p) => <Icon {...p} d={<><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 010 7"/><path d="M19 5a9 9 0 010 14"/></>} />,
  VolumeOff: (p) => <Icon {...p} d={<><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M22 9l-6 6M16 9l6 6"/></>} />,
  User: (p) => <Icon {...p} d={<><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></>} />,
  Settings: (p) => <Icon {...p} d={<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33h.01a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"/></>} />,
  LogOut: (p) => <Icon {...p} d={<><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/></>} />,
  Building: (p) => <Icon {...p} d={<><rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 8h.01M15 8h.01M9 12h.01M15 12h.01M9 16h.01M15 16h.01"/></>} />,
  Network: (p) => <Icon {...p} d={<><circle cx="12" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="M12 7v3M12 10l-5 7M12 10l5 7"/></>} />,
  Upload: (p) => <Icon {...p} d={<><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M17 8l-5-5-5 5M12 3v12"/></>} />,
  FileText: (p) => <Icon {...p} d={<><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></>} />,
  MessageSquare: (p) => <Icon {...p} d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />,
  ArrowRight: (p) => <Icon {...p} d="M5 12h14M12 5l7 7-7 7" />,
  CornerDownLeft: (p) => <Icon {...p} d="M9 10l-5 5 5 5M20 4v7a4 4 0 01-4 4H4" />,
  Sparkles: (p) => <Icon {...p} d="M12 3l1.9 5.5L19 10l-5.1 1.5L12 17l-1.9-5.5L5 10l5.1-1.5L12 3zM19 17l.9 2.5L22 20l-2.1.5L19 23l-.9-2.5L16 20l2.1-.5L19 17z" />,
  Menu: (p) => <Icon {...p} d="M3 12h18M3 6h18M3 18h18" />,
  Globe: (p) => <Icon {...p} d={<><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 010 20M12 2a15.3 15.3 0 000 20"/></>} />,
  Shield: (p) => <Icon {...p} d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
  Book: (p) => <Icon {...p} d={<><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></>} />,
  Inbox: (p) => <Icon {...p} d={<><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13l3.5 7v6a2 2 0 01-2 2H4a2 2 0 01-2-2v-6L5.5 5z"/></>} />,
  Cpu: (p) => <Icon {...p} d={<><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/></>} />,
  ArrowUpRight: (p) => <Icon {...p} d="M7 17L17 7M7 7h10v10" />,
  CreditCard: (p) => <Icon {...p} d={<><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></>} />,
};

window.Icons = Icons;
window.TrailLogoSvg = TrailLogo;
