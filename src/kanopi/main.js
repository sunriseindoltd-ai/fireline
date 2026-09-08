// @ts-nocheck
// App shell: sidebar + routed content (Home / Dashboard / Map).
import { createRouter } from './router.js';
import * as Sidebar from './views/Sidebar.js';
import * as HomeView from './views/home/HomeView.js';
import * as DashboardView from './views/dashboard/DashboardView.js';
import * as ProjectView from './views/project/ProjectView.js';
import * as ReportView from './views/report/ReportView.js';
import * as DataView from './views/data/DataView.js';
import * as CasesView from './views/cases/CasesView.js';
import * as SignalsView from './views/signals/SignalsView.js';

function install401Guard() {
  const orig = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const res = await orig(input, init);
    try {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : '';
      if (res.status === 401 && String(url).includes('/data/')) {
        window.location.assign('/login');
      }
    } catch { /* ignore */ }
    return res;
  };
  return () => { window.fetch = orig; };
}

export function startKanopi() {
  const content = document.getElementById('content');
  const sidebarEl = document.getElementById('sidebar');
  if (!content || !sidebarEl) return () => {};

  const restoreFetch = install401Guard();
  let destroy = null;
  let cancelled = false;
  const router = createRouter(onRoute);

  async function onRoute(route) {
    if (cancelled) return;
    if (destroy) { try { destroy(); } catch { /* ignore */ } destroy = null; }
    content.className = '';
    content.innerHTML = '';
    const ctx = { router, ...route };
    try {
      if (route.name === 'project' && route.tab === 'map') destroy = await ProjectView.mount(content, ctx);
      else if (route.name === 'project' && route.tab === 'report') destroy = await ReportView.mount(content, ctx);
      else if (route.name === 'project' && route.tab === 'data') destroy = await DataView.mount(content, ctx);
      else if (route.name === 'project' && route.tab === 'cases') destroy = await CasesView.mount(content, ctx);
      else if (route.name === 'project' && route.tab === 'signals') destroy = await SignalsView.mount(content, ctx);
      else if (route.name === 'project') destroy = await DashboardView.mount(content, ctx);
      else destroy = await HomeView.mount(content, ctx);
    } catch (err) {
      content.className = 'shell-scroll';
      content.innerHTML = `<div class="fatal"><b>Gagal memuat.</b><br>${err.message}</div>`;
    }
  }

  let unmountSidebar = () => {};
  Sidebar.mount(sidebarEl, router).then((handle) => {
    if (cancelled) { handle?.(); return; }
    unmountSidebar = handle || (() => {});
    router.start();
  });

  return () => {
    cancelled = true;
    restoreFetch();
    router.stop();
    unmountSidebar();
    if (destroy) { try { destroy(); } catch { /* ignore */ } }
  };
}
