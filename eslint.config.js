import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * Aturan lint untuk Dayang Spa.
 *
 * Yang paling penting: aturan `no-undef` dibuat error. Aturan ini yang menangkap
 * salah ketik nama variabel, misalnya `singkat` padahal variabelnya
 * `singkas`. Kalau lolos, halaman jadi layar putih saat dibuka karena React
 * melempar ReferenceError, padahal `npm run build` tetap sukses karena
 * build tidak pernah menjalankan kode halaman.
 *
 * Aturan lain dari recommended dibiarkan sebagai peringatan, bukan error,
 * supaya tidak membanjiri laporan dengan hal yang belum perlu dirapikan.
 */
export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'public/**', 'mockups/**', 'website/**', 'supabase/**']
  },

  js.configs.recommended,

  {
    // Many files already carry eslint-disable comments for these rules, so the
    // plugin has to be registered or ESLint treats the directives as errors.
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn'
    }
  },

  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true }
      },
      globals: {
        ...globals.browser,
        ...globals.es2021
      }
    },
    rules: {
      // Wajib lolos: ini penjaga halaman tetap bisa dibuka.
      'no-undef': 'error',

      // Memberi peringatan saja.
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-constant-condition': ['warn', { checkLoops: false }],
      'no-dupe-keys': 'warn',
      'no-duplicate-case': 'warn',
      'no-self-compare': 'warn',
      'no-unreachable': 'warn',
      'no-fallthrough': 'warn',
      'no-cond-assign': 'warn',
      'use-isnan': 'error',
      'valid-typeof': 'error'
    }
  },

  {
    // Skrip Node di root repository.
    files: ['**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node
      }
    },
    rules: {
      'no-undef': 'error'
    }
  }
];