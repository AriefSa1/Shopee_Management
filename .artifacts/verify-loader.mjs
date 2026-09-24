import { pathToFileURL } from 'node:url';

const roots = {
  hono: 'C:/Users/Kuda/.pnpm-vstore-shopee/hono@4.13.7/node_modules/hono',
  '@hono/node-server': 'C:/Users/Kuda/.pnpm-vstore-shopee/@hono+node-server@1.19.17_hono@4.13.7/node_modules/@hono/node-server',
  zod: 'C:/Users/Kuda/.pnpm-vstore-shopee/zod@4.5.4/node_modules/zod',
};

export async function resolve(specifier, context, defaultResolve) {
  for (const [name, root] of Object.entries(roots)) {
    if (specifier === name) {
      const entry = name === 'hono' ? 'dist/index.js' : name === 'zod' ? 'index.js' : 'dist/index.mjs';
      return { url: pathToFileURL(`${root}/${entry}`).href, shortCircuit: true };
    }
    if (specifier.startsWith(`${name}/`)) {
      return { url: pathToFileURL(`${root}/${specifier.slice(name.length + 1)}`).href, shortCircuit: true };
    }
  }
  return defaultResolve(specifier, context, defaultResolve);
}
