const paths: Record<string, string> = {
  mountain: '<path d="m2 19 7-13 5 8 3-5 6 10H2Z"/><path d="m9 6 2.8 5H6.4"/>',
  rock: '<path d="m5 7 9-3 7 6-2 9-11 2-5-7 2-7Z"/><path d="m5 7 7 5 9-2M12 12l-4 9"/>',
  stone: '<path d="m3 14 5-8 8-1 6 7-4 8H7l-4-6Z"/><path d="m8 6 3 9 11-3m-11 3-4 5"/>',
  wood: '<path d="m4 9 12-5 5 5-12 10-5-3V9Z"/><path d="m4 9 5 4 12-4M9 13v6m-2-8 10-5"/>',
  fiber: '<path d="M12 22V5m0 10L6 9m6 2 6-7M12 19l7-6M12 7 8 3M7 20l-3-7m13 8 4-4"/>',
  berries:
    '<circle cx="8" cy="14" r="4"/><circle cx="16" cy="14" r="4"/><circle cx="12" cy="19" r="3"/><path d="M12 11V5m0 2c-6 0-6-5-6-5s6 0 6 5Zm0 2c0-6 6-6 6-6s0 6-6 6Z"/>',
  meat: '<path d="M5 19c-6-5 0-10 4-14s12-1 11 5-10 14-15 9Z"/><path d="M9 15c-3-3 0-6 3-7s5 0 4 3-4 7-7 4Z"/>',
  hatchet: '<path d="m6 22 9-17 2 1-9 17M14 5l-5-3-6 9 8 3m5-8 5 1-3 7-6-1"/>',
  pickaxe: '<path d="m5 22 10-18 2 1-10 18M3 5c8-5 16-2 19 7l-8-5-11-2Z"/>',
  spear: '<path d="m3 21 13-13m-2-5 7-1-1 7-6-6Z"/>',
  bow: '<path d="M7 2c15 5 15 15 0 20L12 12 7 2Zm-4 10h18m-4-3 4 3-4 3"/>',
  pistol: '<path d="M3 6h18v5H10l-2 9H3l2-9H3V6Zm7 5h5v4h-6M17 6V4"/>',
  rifle: '<path d="M2 13h5l3-4h11v3H10l-3 5H2v-4Zm11-4V6h5v3m-5 3 2 6m-3-6v3h4M21 10h2"/>',
  ammo: '<path d="M5 21V9l3-6 3 6v12H5Zm0-4h6m4 4V9l3-6 3 6v12h-6Zm0-4h6"/>',
  armor: '<path d="m3 5 5-3 4 4 4-4 5 3-2 6v11H5V11L3 5Zm5-3v8h8V2M8 14h8m-8 4h8"/>',
  bandage:
    '<rect x="3" y="7" width="18" height="10" rx="3" transform="rotate(-40 12 12)"/><path d="m9 11 4-3 3 4-4 3-3-4Z"/>',
  foundation: '<path d="m2 9 10-5 10 5-10 5-10-5Zm0 0v8l10 5 10-5V9M12 14v8M7 7l10 5M7 12v7"/>',
  wall: '<path d="M3 21V5l18-3v17L3 21Zm6-17v16M15 3v17M3 9l18-3M3 17l18-3"/>',
  fire: '<path d="M12 2c3 6-2 7 2 10 2-2 2-4 2-4 8 10 0 15-5 13-6-2-7-7-3-12 0 4 4 3 4-7Z"/>',
  bed: '<path d="M3 17V7h18v10M3 13h18M7 7v6m-4 4v3m18-3v3"/>',
  heart: '<path d="M12 21S1 14 2 7s8-5 10-1c2-4 9-6 10 1s-10 14-10 14Z"/>',
  water: '<path d="M12 2S4 11 4 15a8 8 0 0 0 16 0c0-4-8-13-8-13Z"/><path d="M8 15c0 3 2 4 4 4"/>',
  food: '<path d="M5 3v8m3-8v8m3-8v8m-6-4h6M8 11v11M19 3c-5 4-5 10 0 10V3Zm0 10v9"/>',
  bolt: '<path d="m13 2-9 12h7l-1 8 10-13h-8l1-7Z"/>',
  bag: '<path d="M5 8h14l2 13H3L5 8Zm3 0V5a4 4 0 0 1 8 0v3M3 14h18M9 12v4m6-4v4"/>',
  map: '<path d="m2 5 7-3 6 3 7-3v17l-7 3-6-3-7 3V5Zm7-3v17m6-14v17"/>',
  settings: '<path d="M4 4v16m8-16v16m8-16v16M1 8h6m2 8h6m2-10h6"/>',
  arrow: '<path d="M3 12h18m-7-7 7 7-7 7"/>',
  close: '<path d="m5 5 14 14M19 5 5 19"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/>',
  compass: '<circle cx="12" cy="12" r="10"/><path d="m16 8-3 5-5 3 3-5 5-3Z"/>',
};
export const icon = (name: string, className = ''): string =>
  `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.rock}</svg>`;
export const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
