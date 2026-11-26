'use strict';
import { t as tr } from '../i18n.js';

/**
 * 图标集回退数据 —— 由 tools/icons/apply-sprite.js 生成，请勿手工编辑。
 *
 * index.html 里内联的是 Lucide（ISC, v1.73.0）路径，ui.iconSet 默认 lucide，
 * 因此默认启动时一次 DOM 操作都不做。只有用户切到 legacy 才调用 applyIconSet()，
 * 把 #icon-sprite 的 symbol 内容整体换回改造前的自绘路径。
 *
 * 两套数据共用同一组 id：静态 <use href="#i-*"> 与 icon() 生成的内容都不需要改写，
 * 也不需要常驻 MutationObserver。切换是一次 replaceChildren。
 */

const LUCIDE_PATHS = {
  "i-grid": "<rect width=\"7\" height=\"7\" x=\"3\" y=\"3\" rx=\"1\" /> <rect width=\"7\" height=\"7\" x=\"14\" y=\"3\" rx=\"1\" /> <rect width=\"7\" height=\"7\" x=\"14\" y=\"14\" rx=\"1\" /> <rect width=\"7\" height=\"7\" x=\"3\" y=\"14\" rx=\"1\" />",
  "i-list": "<path d=\"M3 5h.01\" /> <path d=\"M3 12h.01\" /> <path d=\"M3 19h.01\" /> <path d=\"M8 5h13\" /> <path d=\"M8 12h13\" /> <path d=\"M8 19h13\" />",
  "i-search": "<path d=\"m21 21-4.34-4.34\" /> <circle cx=\"11\" cy=\"11\" r=\"8\" />",
  "i-plus": "<path d=\"M5 12h14\" /> <path d=\"M12 5v14\" />",
  "i-refresh": "<path d=\"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8\" /> <path d=\"M21 3v5h-5\" /> <path d=\"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16\" /> <path d=\"M8 16H3v5\" />",
  "i-dice": "<rect width=\"12\" height=\"12\" x=\"2\" y=\"10\" rx=\"2\" ry=\"2\" /> <path d=\"m17.92 14 3.5-3.5a2.24 2.24 0 0 0 0-3l-5-4.92a2.24 2.24 0 0 0-3 0L10 6\" /> <path d=\"M6 18h.01\" /> <path d=\"M10 14h.01\" /> <path d=\"M15 6h.01\" /> <path d=\"M18 9h.01\" />",
  "i-moon": "<path d=\"M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401\" />",
  "i-sun": "<circle cx=\"12\" cy=\"12\" r=\"4\" /> <path d=\"M12 2v2\" /> <path d=\"M12 20v2\" /> <path d=\"m4.93 4.93 1.41 1.41\" /> <path d=\"m17.66 17.66 1.41 1.41\" /> <path d=\"M2 12h2\" /> <path d=\"M20 12h2\" /> <path d=\"m6.34 17.66-1.41 1.41\" /> <path d=\"m19.07 4.93-1.41 1.41\" />",
  "i-settings": "<path d=\"M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915\" /> <circle cx=\"12\" cy=\"12\" r=\"3\" />",
  "i-star": "<path d=\"M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z\" />",
  "i-clock": "<circle cx=\"12\" cy=\"12\" r=\"10\" /> <path d=\"M12 6v6l4 2\" />",
  "i-circle": "<circle cx=\"12\" cy=\"12\" r=\"10\" />",
  "i-folder": "<path d=\"M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z\" />",
  "i-folder-open": "<path d=\"m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2\" />",
  "i-tag": "<path d=\"M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z\" /> <circle cx=\"7.5\" cy=\"7.5\" r=\".5\" fill=\"currentColor\" />",
  "i-sparkle": "<path d=\"M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z\" /> <path d=\"M20 2v4\" /> <path d=\"M22 4h-4\" /> <circle cx=\"4\" cy=\"20\" r=\"2\" />",
  "i-check": "<path d=\"M20 6 9 17l-5-5\" />",
  "i-check-circle": "<circle cx=\"12\" cy=\"12\" r=\"10\" /> <path d=\"m16 9-5.5 5.5L8 12\" />",
  "i-copy": "<rect width=\"14\" height=\"14\" x=\"8\" y=\"8\" rx=\"2\" ry=\"2\" /> <path d=\"M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2\" />",
  "i-alert": "<path d=\"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3\" /> <path d=\"M12 9v4\" /> <path d=\"M12 17h.01\" />",
  "i-box": "<path d=\"M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z\" /> <path d=\"M12 22V12\" /> <polyline points=\"3.29 7 12 12 20.71 7\" /> <path d=\"m7.5 4.27 9 5.15\" />",
  "i-cube": "<path d=\"M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z\" /> <path d=\"m3.3 7 8.7 5 8.7-5\" /> <path d=\"M12 22V12\" />",
  "i-sliders": "<path d=\"M10 5H3\" /> <path d=\"M12 19H3\" /> <path d=\"M14 3v4\" /> <path d=\"M16 17v4\" /> <path d=\"M21 12h-9\" /> <path d=\"M21 19h-5\" /> <path d=\"M21 5h-7\" /> <path d=\"M8 10v4\" /> <path d=\"M8 12H3\" />",
  "i-tool": "<path d=\"m15 12-9.373 9.373a1 1 0 0 1-3.001-3L12 9\" /> <path d=\"m18 15 4-4\" /> <path d=\"m21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172v-.344a2 2 0 0 0-.586-1.414l-1.657-1.657A6 6 0 0 0 12.516 3H9l1.243 1.243A6 6 0 0 1 12 8.485V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5\" />",
  "i-close": "<path d=\"M18 6 6 18\" /> <path d=\"m6 6 12 12\" />",
  "i-chevron-left": "<path d=\"m15 18-6-6 6-6\" />",
  "i-chevron-right": "<path d=\"m9 18 6-6-6-6\" />",
  "i-chevron-down": "<path d=\"m6 9 6 6 6-6\" />",
  "i-more": "<circle cx=\"12\" cy=\"12\" r=\"1\" /> <circle cx=\"19\" cy=\"12\" r=\"1\" /> <circle cx=\"5\" cy=\"12\" r=\"1\" />",
  "i-trash": "<path d=\"M10 11v6\" /> <path d=\"M14 11v6\" /> <path d=\"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6\" /> <path d=\"M3 6h18\" /> <path d=\"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2\" />",
  "i-edit": "<path d=\"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z\" /> <path d=\"m15 5 4 4\" />",
  "i-external": "<path d=\"M15 3h6v6\" /> <path d=\"M10 14 21 3\" /> <path d=\"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6\" />",
  "i-printer": "<path d=\"M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2\" /> <path d=\"M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6\" /> <rect x=\"6\" y=\"14\" width=\"12\" height=\"8\" rx=\"1\" />",
  "i-filter": "<path d=\"M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z\" />",
  "i-sort": "<path d=\"m21 16-4 4-4-4\" /> <path d=\"M17 20V4\" /> <path d=\"m3 8 4-4 4 4\" /> <path d=\"M7 4v16\" />",
  "i-image": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" ry=\"2\" /> <circle cx=\"9\" cy=\"9\" r=\"2\" /> <path d=\"m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21\" />",
  "i-download": "<path d=\"M12 15V3\" /> <path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\" /> <path d=\"m7 10 5 5 5-5\" />",
  "i-upload": "<path d=\"M12 3v12\" /> <path d=\"m17 8-5-5-5 5\" /> <path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\" />",
  "i-undo": "<path d=\"M9 14 4 9l5-5\" /> <path d=\"M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11\" />",
  "i-link": "<path d=\"M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71\" /> <path d=\"M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71\" />",
  "i-info": "<circle cx=\"12\" cy=\"12\" r=\"10\" /> <path d=\"M12 16v-4\" /> <path d=\"M12 8h.01\" />",
  "i-hard-drive": "<path d=\"M10 16h.01\" /> <path d=\"M2.212 11.577a2 2 0 0 0-.212.896V18a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5.527a2 2 0 0 0-.212-.896L18.55 5.11A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z\" /> <path d=\"M21.946 12.013H2.054\" /> <path d=\"M6 16h.01\" />",
  "i-save": "<path d=\"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z\" /> <path d=\"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7\" /> <path d=\"M7 3v4a1 1 0 0 0 1 1h7\" />",
  "i-eye": "<path d=\"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0\" /> <circle cx=\"12\" cy=\"12\" r=\"3\" />",
  "i-layers": "<path d=\"M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z\" /> <path d=\"M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12\" /> <path d=\"M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17\" />",
  "i-shuffle": "<path d=\"m18 14 4 4-4 4\" /> <path d=\"m18 2 4 4-4 4\" /> <path d=\"M2 18h1.973a4 4 0 0 0 3.3-1.7l5.454-8.6a4 4 0 0 1 3.3-1.7H22\" /> <path d=\"M2 6h1.972a4 4 0 0 1 3.6 2.2\" /> <path d=\"M22 18h-6.041a4 4 0 0 1-3.3-1.8l-.359-.45\" />",
  "i-play": "<path d=\"M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z\" />",
  "i-pause": "<rect x=\"14\" y=\"3\" width=\"5\" height=\"18\" rx=\"1\" /> <rect x=\"5\" y=\"3\" width=\"5\" height=\"18\" rx=\"1\" />",
  "i-minus": "<path d=\"M5 12h14\" />",
  "i-square": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" />",
  "i-x": "<path d=\"M18 6 6 18\" /> <path d=\"m6 6 12 12\" />",
  "i-heart": "<path d=\"M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5\" />",
  "i-warning": "<circle cx=\"12\" cy=\"12\" r=\"10\" /> <line x1=\"12\" x2=\"12\" y1=\"8\" y2=\"12\" /> <line x1=\"12\" x2=\"12.01\" y1=\"16\" y2=\"16\" />",
  "i-cloud": "<path d=\"M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z\" />",
  "i-wrench": "<path d=\"M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z\" />",
  "i-gear": "<path d=\"M11 10.27 7 3.34\" /> <path d=\"m11 13.73-4 6.93\" /> <path d=\"M12 22v-2\" /> <path d=\"M12 2v2\" /> <path d=\"M14 12h8\" /> <path d=\"m17 20.66-1-1.73\" /> <path d=\"m17 3.34-1 1.73\" /> <path d=\"M2 12h2\" /> <path d=\"m20.66 17-1.73-1\" /> <path d=\"m20.66 7-1.73 1\" /> <path d=\"m3.34 17 1.73-1\" /> <path d=\"m3.34 7 1.73 1\" /> <circle cx=\"12\" cy=\"12\" r=\"2\" /> <circle cx=\"12\" cy=\"12\" r=\"8\" />",
  "i-globe": "<circle cx=\"12\" cy=\"12\" r=\"10\" /> <path d=\"M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20\" /> <path d=\"M2 12h20\" />",
};

const LEGACY_PATHS = {
  "i-grid": "<rect x=\"3\" y=\"3\" width=\"7\" height=\"7\" rx=\"1.5\"/><rect x=\"14\" y=\"3\" width=\"7\" height=\"7\" rx=\"1.5\"/><rect x=\"3\" y=\"14\" width=\"7\" height=\"7\" rx=\"1.5\"/><rect x=\"14\" y=\"14\" width=\"7\" height=\"7\" rx=\"1.5\"/>",
  "i-list": "<path d=\"M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01\"/>",
  "i-search": "<circle cx=\"11\" cy=\"11\" r=\"7\"/><path d=\"m20 20-3.5-3.5\"/>",
  "i-plus": "<path d=\"M12 5v14M5 12h14\"/>",
  "i-refresh": "<path d=\"M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7\"/>",
  "i-dice": "<rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"4\"/><circle cx=\"8.5\" cy=\"8.5\" r=\"1\"/><circle cx=\"15.5\" cy=\"15.5\" r=\"1\"/><circle cx=\"12\" cy=\"12\" r=\"1\"/>",
  "i-moon": "<path d=\"M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z\"/>",
  "i-sun": "<circle cx=\"12\" cy=\"12\" r=\"4\"/><path d=\"M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4\"/>",
  "i-settings": "<circle cx=\"12\" cy=\"12\" r=\"3\"/><path d=\"M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z\"/>",
  "i-star": "<path d=\"m12 2.8 2.8 5.7 6.3.9-4.6 4.4 1.1 6.3-5.6-3-5.6 3 1.1-6.3L2.9 9.4l6.3-.9Z\"/>",
  "i-clock": "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 7v5l3.5 2\"/>",
  "i-circle": "<circle cx=\"12\" cy=\"12\" r=\"9\"/>",
  "i-folder": "<path d=\"M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h7A1.5 1.5 0 0 1 19 10v7.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 3 17.5Z\"/>",
  "i-folder-open": "<path d=\"M3 8V6.5A1.5 1.5 0 0 1 4.5 5h4l2 2.5h7A1.5 1.5 0 0 1 19 9v1M3 8v9.5A1.5 1.5 0 0 0 4.5 19h13.2a1.5 1.5 0 0 0 1.4-1l2.4-7.1a1 1 0 0 0-.9-1.4H3Z\"/>",
  "i-tag": "<path d=\"M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z\"/><circle cx=\"7.5\" cy=\"7.5\" r=\"1.3\"/>",
  "i-sparkle": "<path d=\"m12 2 2.2 6.3L20.5 10l-6.3 2.2L12 18.5l-2.2-6.3L3.5 10l6.3-1.7Z\"/><path d=\"m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8Z\"/>",
  "i-check": "<path d=\"m4 12.5 5 5L20 6.5\"/>",
  "i-check-circle": "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"m8 12.5 2.5 2.5L16 9.5\"/>",
  "i-copy": "<rect x=\"8\" y=\"8\" width=\"12\" height=\"12\" rx=\"2\"/><path d=\"M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2\"/>",
  "i-alert": "<path d=\"M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0Z\"/><path d=\"M12 9v4M12 16.5h.01\"/>",
  "i-box": "<path d=\"m12 2.5 8.5 4.8v9.4L12 21.5 3.5 16.7V7.3Z\"/><path d=\"m3.7 7.5 8.3 4.7 8.3-4.7M12 12.2v9\"/>",
  "i-cube": "<path d=\"m12 2.5 8.5 4.8v9.4L12 21.5 3.5 16.7V7.3Z\"/><path d=\"m3.7 7.5 8.3 4.7 8.3-4.7M12 12.2v9\"/>",
  "i-sliders": "<path d=\"M4 7h9M17 7h3M4 17h3M11 17h9\"/><circle cx=\"15\" cy=\"7\" r=\"2\"/><circle cx=\"9\" cy=\"17\" r=\"2\"/>",
  "i-tool": "<path d=\"M14.5 6.5a4.5 4.5 0 0 0 5.8 5.8l-8 8a2.8 2.8 0 0 1-4-4Z\"/><path d=\"m14.5 6.5 3-3 3 3-3 3\"/>",
  "i-close": "<path d=\"M6 6l12 12M18 6 6 18\"/>",
  "i-chevron-left": "<path d=\"m14.5 5-7 7 7 7\"/>",
  "i-chevron-right": "<path d=\"m9.5 5 7 7-7 7\"/>",
  "i-chevron-down": "<path d=\"m5 9 7 7 7-7\"/>",
  "i-more": "<circle cx=\"5\" cy=\"12\" r=\"1.4\"/><circle cx=\"12\" cy=\"12\" r=\"1.4\"/><circle cx=\"19\" cy=\"12\" r=\"1.4\"/>",
  "i-trash": "<path d=\"M4 7h16M9 7V4.5h6V7M6 7l1 13h10l1-13M10 11v5M14 11v5\"/>",
  "i-edit": "<path d=\"M4 20h4L20 8l-4-4L4 16Z\"/><path d=\"m14 6 4 4\"/>",
  "i-external": "<path d=\"M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5\"/>",
  "i-printer": "<path d=\"M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1h-2\"/><path d=\"M6 15h12v6H6zM17 12h.01\"/>",
  "i-filter": "<path d=\"M3 5h18l-7 8v6l-4 2v-8Z\"/>",
  "i-sort": "<path d=\"M7 4v16m0 0-3-3m3 3 3-3M17 20V4m0 0-3 3m3-3 3 3\"/>",
  "i-image": "<rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\"/><circle cx=\"8.5\" cy=\"8.5\" r=\"1.5\"/><path d=\"m21 15-5-5L5 21\"/>",
  "i-download": "<path d=\"M12 3v12m0 0 4-4m-4 4-4-4M4 17v3h16v-3\"/>",
  "i-upload": "<path d=\"M12 16V4m0 0 4 4m-4-4L8 8M4 17v3h16v-3\"/>",
  "i-undo": "<path d=\"M4 9h10a6 6 0 0 1 0 12h-3M4 9l4-4M4 9l4 4\"/>",
  "i-link": "<path d=\"M10 13a5 5 0 0 0 7.5.5l2-2A5 5 0 0 0 12.5 4.5l-1 1M14 11a5 5 0 0 0-7.5-.5l-2 2A5 5 0 0 0 11.5 19.5l1-1\"/>",
  "i-info": "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 11v5M12 8h.01\"/>",
  "i-hard-drive": "<rect x=\"2.5\" y=\"5\" width=\"19\" height=\"14\" rx=\"2\"/><path d=\"M2.5 14h19M6.5 16.5h.01M10 16.5h.01\"/>",
  "i-save": "<path d=\"M4 4h13l3 3v13H4Z\"/><path d=\"M8 4v6h8V4M8 20v-6h8v6\"/>",
  "i-eye": "<path d=\"M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z\"/><circle cx=\"12\" cy=\"12\" r=\"2.7\"/>",
  "i-layers": "<path d=\"m12 3 9 5-9 5-9-5Z\"/><path d=\"m3 13 9 5 9-5M3 17.5l9 5 9-5\"/>",
  "i-shuffle": "<path d=\"M3 6h3.5c4 0 6 12 10.5 12H21M3 18h3.5c2.5 0 4.2-3 5.6-6M15 8.2c.8-1.3 1.7-2.2 2.5-2.2H21M18 3l3 3-3 3M18 15l3 3-3 3\"/>",
  "i-play": "<path d=\"m7 4 13 8-13 8Z\"/>",
  "i-pause": "<path d=\"M8 4v16M16 4v16\"/>",
  "i-minus": "<path d=\"M5 12h14\"/>",
  "i-square": "<rect x=\"5\" y=\"5\" width=\"14\" height=\"14\" rx=\"1.5\"/>",
  "i-x": "<path d=\"M6 6l12 12M18 6 6 18\"/>",
  "i-heart": "<path d=\"M20.8 5.6a5 5 0 0 0-7.1 0L12 7.3l-1.7-1.7a5 5 0 0 0-7.1 7.1L12 21l8.8-8.3a5 5 0 0 0 0-7.1Z\"/>",
  "i-warning": "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 7v6M12 16.5h.01\"/>",
  "i-cloud": "<path d=\"M17.5 18h-11a4.5 4.5 0 0 1-.4-8.98A6 6 0 0 1 17.7 8.6 3.8 3.8 0 0 1 17.5 18Z\"/>",
  "i-wrench": "<path d=\"M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z\" />",
  "i-gear": "<path d=\"M11 10.27 7 3.34\" /> <path d=\"m11 13.73-4 6.93\" /> <path d=\"M12 22v-2\" /> <path d=\"M12 2v2\" /> <path d=\"M14 12h8\" /> <path d=\"m17 20.66-1-1.73\" /> <path d=\"m17 3.34-1 1.73\" /> <path d=\"M2 12h2\" /> <path d=\"m20.66 17-1.73-1\" /> <path d=\"m20.66 7-1.73 1\" /> <path d=\"m3.34 17 1.73-1\" /> <path d=\"m3.34 7 1.73 1\" /> <circle cx=\"12\" cy=\"12\" r=\"2\" /> <circle cx=\"12\" cy=\"12\" r=\"8\" />",
  "i-globe": "<circle cx=\"12\" cy=\"12\" r=\"10\" /> <path d=\"M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20\" /> <path d=\"M2 12h20\" />",
};

// index.html 内联的就是 lucide，所以默认值下 applyIconSet('lucide') 是零 DOM 操作。
let currentSet = 'lucide';

function parseSymbols(html) {
  const doc = new DOMParser().parseFromString(
    '<svg xmlns="http://www.w3.org/2000/svg">' + html + '</svg>',
    'image/svg+xml');
  if (doc.querySelector('parsererror')) return null;
  return Array.from(doc.documentElement.children)
    .map((n) => document.importNode(n, true));
}

/** 切换图标集。set 只允许 'lucide' | 'legacy'，其它值一律按 lucide 处理。 */
export function applyIconSet(set) {
  const target = set === 'legacy' ? 'legacy' : 'lucide';
  const table = target === 'legacy' ? LEGACY_PATHS : LUCIDE_PATHS;
  const sprite = document.getElementById('icon-sprite');
  const root = document.documentElement;
  if (root.dataset.iconset !== target) root.dataset.iconset = target;
  if (!sprite || currentSet === target) return root.dataset.iconset;
  const html = Object.keys(table).map((id) =>
    '<symbol id="' + id + '" viewBox="0 0 24 24">' + table[id] + '</symbol>').join('');
  const nodes = parseSymbols(html);
  if (!nodes || nodes.length !== Object.keys(table).length) {
    console.warn(tr('[icon-set] sprite 解析失败，保持原有图标'));
    return root.dataset.iconset;
  }
  sprite.replaceChildren(...nodes);
  currentSet = target;
  return root.dataset.iconset;
}

export function currentIconSet() { return currentSet || 'lucide'; }
export function iconSetIds() { return Object.keys(LUCIDE_PATHS); }
export function iconSetBodies(set) {
  return set === 'legacy' ? LEGACY_PATHS : LUCIDE_PATHS;
}

// 只读诊断接口：probe-icons.js / probe-motion.js 用来验证两套路径都能装载。
// 正式业务只走 applyIconSet()，不依赖这个全局对象。
if (typeof window !== 'undefined') {
  window.__printshelfIcons = {
    get set() { return currentSet; },
    apply: applyIconSet,
    ids: iconSetIds,
    bodies: iconSetBodies,
  };
}
