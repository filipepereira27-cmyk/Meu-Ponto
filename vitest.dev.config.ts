// Ferramentas de diagnóstico (não fazem parte da suíte): `npx vitest run -c vitest.dev.config.ts <arquivo>`
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/**/*.dev.ts'], testTimeout: 600_000 } });
