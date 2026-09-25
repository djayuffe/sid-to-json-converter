import { build } from 'esbuild';

await build({
  entryPoints: ['cli/sid-json.ts'],
  outfile: 'dist-cli/sid-json.mjs',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  sourcemap: true,
});
