import { config } from '@n8n/node-cli/eslint';

// test/ never ships (files: dist only), so the no-dependencies rule for
// n8n Cloud does not apply to it; vitest is a devDependency.
export default [{ ignores: ['test/**'] }, ...config];
