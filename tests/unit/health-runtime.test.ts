import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import ts from 'typescript';
import { expect, it } from 'vitest';
import pkg from '../../package.json' with { type: 'json' };
import { PROTOCOL_VERSION } from '../../src/shared/protocol';

const run = promisify(execFile);

it('loads the emitted health function in native Node ESM without a bundler', async () => {
  const root = resolve(import.meta.dirname, '../..');
  const output = await mkdtemp(join(tmpdir(), 'rbb-health-runtime-'));
  try {
    // Vite/Vitest resolve extensionless imports that the deployed Node runtime rejects.
    const program = ts.createProgram([join(root, 'api/health.ts')], {
      rootDir: root,
      outDir: output,
      target: ts.ScriptTarget.ES2023,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      resolveJsonModule: true,
      esModuleInterop: true,
      skipLibCheck: true,
      noEmitOnError: true,
      types: ['node'],
    });
    const diagnostics = ts.getPreEmitDiagnostics(program);
    expect(
      ts.formatDiagnostics(diagnostics, {
        getCanonicalFileName: (path) => path,
        getCurrentDirectory: () => root,
        getNewLine: () => '\n',
      }),
    ).toBe('');
    expect(program.emit().emitSkipped).toBe(false);
    const entry = pathToFileURL(join(output, 'api/health.js')).href;
    const { stdout } = await run(process.execPath, [
      '--input-type=module',
      '--eval',
      `const { GET } = await import(${JSON.stringify(entry)});
       const response = GET();
       console.log(JSON.stringify({ status: response.status,
         cache: response.headers.get('Cache-Control'), body: await response.json() }));`,
    ]);
    expect(JSON.parse(stdout)).toEqual({
      status: 200,
      cache: 'no-store',
      body: {
        service: 'rbb-client',
        version: pkg.version,
        protocol: PROTOCOL_VERSION,
        status: 'ok',
      },
    });
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
