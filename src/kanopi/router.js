// @ts-nocheck
// Hash router. Routes:
//   #/                       home (portfolio)
//   #/project/<id>           chain dashboard
//   #/project/<id>/map       chain map workspace
export function createRouter(onRoute) {
  function parse() {
    const h = (location.hash || '#/').replace(/^#/, '');
    const m = h.match(/^\/project\/([^/]+)(?:\/([^/]+))?/);
    if (m) return { name: 'project', projectId: decodeURIComponent(m[1]), tab: m[2] || 'dashboard' };
    return { name: 'home' };
  }
  const onHash = () => onRoute(parse());
  return {
    start() { window.addEventListener('hashchange', onHash); onRoute(parse()); },
    stop() { window.removeEventListener('hashchange', onHash); },
    go(hash) { location.hash = hash; },
    current: parse,
  };
}
