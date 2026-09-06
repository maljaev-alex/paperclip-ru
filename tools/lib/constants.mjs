export const TOOL_NAME = "paperclip-ru";
export const TOOL_VERSION = "1.0.0";
export const MANIFEST_SCHEMA = "paperclip-ru-manifest/v3";
export const MANIFEST_SCHEMAS_SUPPORTED = Object.freeze([
  "paperclip-ru-manifest/v2",
  "paperclip-ru-manifest/v3",
]);

export const OVERLAY_FILE = "paperclip-ru-overlay.js";
export const INDEX_MARKER = "PAPERCLIP_RU_OVERLAY";
export const WORK_DIR_NAME = ".paperclip-ru";
export const INSTALL_MARKER = ".paperclip-ru-owned.json";
export const ARCHIVE_ROOT = "paperclip-ru";

export const EXIT = Object.freeze({
  OK: 0,
  ERROR: 1,
  USAGE: 2,
  NOT_FOUND: 3,
  UNSUPPORTED: 4,
  CONFLICT: 5,
  PERMISSION: 6,
});

export const NEXT_ACTION = Object.freeze({
  NONE: "none",
  APPLY: "apply",
  REAPPLY: "reapply",
  REVERT: "revert",
  VERIFY: "verify",
  UPDATE_TOOL: "update_tool",
  FORCE_MANUAL: "force_manual",
  REPORT: "report",
  DOCTOR: "doctor",
});

export const STATE = Object.freeze({
  NOT_INSTALLED: "not_installed",
  INSTALLED_NOT_APPLIED: "installed_not_applied",
  APPLIED_CURRENT: "applied/current",
  APPLIED_STALE: "applied/stale",
  CONFLICT: "conflict",
  CONFLICT_PARTIAL: "conflict/partial",
  UNSUPPORTED: "unsupported",
});

export const COMMANDS = Object.freeze([
  "doctor",
  "status",
  "verify",
  "apply",
  "reapply",
  "revert",
  "extract",
  "report",
  "install",
  "update",
  "uninstall",
  "help",
]);

export const FEATURE_TRANSLATION = "translation";
export const FEATURE_PANEL_RESIZE = "panel-resize";
