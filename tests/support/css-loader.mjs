// The loader hook css.mjs registers: any .css import is an empty module, and a Vite asset URL
// import ('./font.ttf?url') is a module whose default export is that file's URL.
export async function load(url, context, next) {
  const u = new URL(url);
  if (u.pathname.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
  if (u.search === '?url') return { format: 'module', source: `export default ${JSON.stringify(u.pathname)};`, shortCircuit: true };
  return next(url, context);
}
