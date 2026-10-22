// Copia o motor do OCR (Tesseract) e os dados do português para public/ocr/,
// para que o reconhecimento funcione sem internet e sem enviar nada a terceiros.
import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'public/ocr');
mkdirSync(resolve(out, 'core'), { recursive: true });
mkdirSync(resolve(out, 'lang'), { recursive: true });

const copy = (from, to) => {
  const src = resolve(root, 'node_modules', from);
  if (!existsSync(src)) throw new Error(`Arquivo não encontrado: ${src}. Rode "npm install".`);
  cpSync(src, resolve(out, to));
};

copy('tesseract.js/dist/worker.min.js', 'worker.min.js');
for (const v of ['lstm', 'simd-lstm', 'relaxedsimd-lstm']) {
  copy(`tesseract.js-core/tesseract-core-${v}.wasm.js`, `core/tesseract-core-${v}.wasm.js`);
}
copy('@tesseract.js-data/por/4.0.0_best_int/por.traineddata.gz', 'lang/por.traineddata.gz');
console.log('OCR: arquivos copiados para public/ocr');
