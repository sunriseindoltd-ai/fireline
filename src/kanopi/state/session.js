// @ts-nocheck
// src/state/session.js — reads the role the React shell (KanopiHost) set on
// window before mounting this app. Single place every view/Sidebar checks
// instead of duplicating the window read.
export function getRole() {
  return typeof window !== 'undefined' ? window.__kanopiRole || 'client' : 'client';
}

export function isAdmin() {
  return getRole() === 'admin';
}
