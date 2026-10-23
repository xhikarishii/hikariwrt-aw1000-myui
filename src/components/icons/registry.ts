// Stroke icons copied from the design canvas (24x24, round caps). Kept as
// inner SVG markup so HkIcon can draw them at any size in currentColor.
// `fill` icons are drawn filled (the selected Home glyph, the dots).

export interface IconDef {
  body: string
  fill?: boolean
  stroke?: number
}

export const ICONS = {
  menu: { body: '<path d="M4 7h16M4 12h16M4 17h16"/>' },
  speed: { body: '<path d="M3.5 17.5a9 9 0 1 1 17 0"/><path d="M12 14l4.5-4.5"/><circle cx="12" cy="14" r="1.2"/>' },
  home: { body: '<rect x="3.5" y="3.5" width="7" height="8.5" rx="2"/><rect x="13.5" y="3.5" width="7" height="5" rx="2"/><rect x="13.5" y="11.5" width="7" height="9" rx="2"/><rect x="3.5" y="15" width="7" height="5.5" rx="2"/>' },
  homeFilled: { body: '<rect x="3.5" y="3.5" width="7" height="8.5" rx="2"/><rect x="13.5" y="3.5" width="7" height="5" rx="2"/><rect x="13.5" y="11.5" width="7" height="9" rx="2"/><rect x="3.5" y="15" width="7" height="5.5" rx="2"/>', fill: true, stroke: 1.6 },
  internet: { body: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>' },
  cellular: { body: '<path d="M4 20v-3M9 20v-6M14 20v-9M19 20V5"/>', stroke: 2.2 },
  wifi: { body: '<path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.2" r="0.8"/>' },
  clients: { body: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5M16 4.8a3.5 3.5 0 0 1 0 6.4M18.5 14.8c1.6.8 2.6 2.5 3 5.2"/>' },
  vpn: { body: '<path d="M12 3l7.5 3v5.5c0 4.5-3.1 8.2-7.5 9.5-4.4-1.3-7.5-5-7.5-9.5V6z"/><path d="M9 12l2.2 2.2L15.5 10"/>' },
  shield: { body: '<path d="M12 3l7.5 3v5.5c0 4.5-3.1 8.2-7.5 9.5-4.4-1.3-7.5-5-7.5-9.5V6z"/>' },
  mesh: { body: '<circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="18" r="2.5"/><circle cx="19" cy="18" r="2.5"/><path d="M10.8 7.2L6.3 15.8M13.2 7.2l4.5 8.6M7.5 18h9"/>' },
  storage: { body: '<rect x="3" y="13" width="18" height="7" rx="2"/><path d="M5.5 13l2-8h9l2 8"/><circle cx="17" cy="16.5" r="0.8"/>' },
  system: { body: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>' },
  advanced: { body: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>' },
  chart: { body: '<path d="M4 4v15.5a.5.5 0 0 0 .5.5H20"/><path d="M7.5 15l4-5 3 3 5-6.5"/>' },
  search: { body: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>' },
  logout: { body: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l4-4-4-4M14 12H4"/>' },
  check: { body: '<path d="M5 12.5l4.5 4.5L19 7.5"/>', stroke: 3 },
  arrowRight: { body: '<path d="M5 12h14M13 6l6 6-6 6"/>', stroke: 2.2 },
  refresh: { body: '<path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/>', stroke: 2.2 },
  ethernet: { body: '<rect x="4" y="5" width="16" height="11" rx="2"/><path d="M9 16v3h6v-3M8 9h.01M12 9h.01M16 9h.01"/>' },
  passthrough: { body: '<path d="M4 8h13M13 4l4 4-4 4M20 16H7M11 12l-4 4 4 4"/>' },
  block: { body: '<circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/>' },
  guest: { body: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5M18 8v6M15 11h6"/>' },
  message: { body: '<path d="M4 5h16v11H9l-5 4z"/>' },
  lock: { body: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>', stroke: 2.2 },
  router: { body: '<rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 16.5h.01M11 16.5h.01M8 9.5a5.5 5.5 0 0 1 8 0M10.3 11.5a2.3 2.3 0 0 1 3.4 0"/>', stroke: 1.5 },
  more: { body: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>', fill: true, stroke: 0 },
  palette: { body: '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.7-.8 1.7-1.6 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5C21 6.6 17 3 12 3z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="14.5" cy="7" r="1"/>' },
  close: { body: '<path d="M6 6l12 12M18 6L6 18"/>' },
  qr: { body: '<rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1"/><path d="M14 14h2.5v2.5H14zM18 18h2.5v2.5H18zM14 18.5v2M18.5 14h2"/>' },
  eye: { body: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>' },
  eyeOff: { body: '<path d="M3 3l18 18M10.6 5.1A10.6 10.6 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7c1.9 0 3.5-.6 4.9-1.4M9.9 9.9a3 3 0 0 0 4.2 4.2"/>' },
  sim: { body: '<path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><rect x="9" y="11" width="6" height="6" rx="1"/>' },
  simOff: { body: '<path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM4 4l16 16"/>' },
  send: { body: '<path d="M4 12L3 4.5 21 12 3 19.5z"/><path d="M4 12h8"/>' },
  arrowLeft: { body: '<path d="M19 12H5M11 6l-6 6 6 6"/>', stroke: 2.2 },
  // Networks: three linked boxes, and a smart-home bulb
  networks: { body: '<rect x="9" y="3" width="6" height="5" rx="1"/><rect x="3" y="16" width="6" height="5" rx="1"/><rect x="15" y="16" width="6" height="5" rx="1"/><path d="M12 8v4M6 16v-2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2"/>' },
  iot: { body: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.6.5 1.1 1.2 1.1 2V16h5v-.2c0-.8.5-1.5 1.1-2A6 6 0 0 0 12 3z"/>' },
  // the log pagers
  chevronLeft: { body: '<path d="M15 6l-6 6 6 6"/>', stroke: 2.2 },
  chevronRight: { body: '<path d="M9 6l6 6-6 6"/>', stroke: 2.2 },
  chevronFirst: { body: '<path d="M17 6l-6 6 6 6M7 6v12"/>', stroke: 2.2 },
  chevronLast: { body: '<path d="M7 6l6 6-6 6M17 6v12"/>', stroke: 2.2 },
  trash: { body: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>' },
  person: { body: '<circle cx="12" cy="8.5" r="4"/><path d="M4.5 20.5c1-4 4-6 7.5-6s6.5 2 7.5 6"/>' },
  moreVert: { body: '<circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/>', fill: true, stroke: 0 },
  chatPlus: { body: '<path d="M20 11.5a8 8 0 0 1-11.6 7.1L4 20l1.4-4.2A8 8 0 1 1 20 11.5z"/><path d="M12 8.5v6M9 11.5h6"/>' },
  soon: { body: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>' },
} satisfies Record<string, IconDef>

export type IconName = keyof typeof ICONS
