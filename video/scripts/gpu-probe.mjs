import { chromium } from 'playwright';
for (const args of [['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'], ['--use-angle=swiftshader']]) {
  const b = await chromium.launch({ headless: true, args });
  const p = await b.newPage();
  const r = await p.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); const e = gl?.getExtension('WEBGL_debug_renderer_info'); return gl ? gl.getParameter(e ? e.UNMASKED_RENDERER_WEBGL : gl.RENDERER) : 'none'; });
  console.log(args[0], '=>', r);
  await b.close();
}
