import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';
import unicorn from 'eslint-plugin-unicorn';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  globalIgnores(['dist', 'node_modules', 'coverage']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      prettierConfig,
    ],
    plugins: {
      prettier,
      unicorn,
    },
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    rules: {
      'prettier/prettier': 'error',
      // 文件名统一小写 + 下划线
      'unicorn/filename-case': ['error', { case: 'snakeCase' }],
      // 跨目录引用统一使用 @ 别名，禁止 ../../ 及以上相对路径
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../../*'],
              message: '跨目录引用请使用 @ 别名（如 @/components/user_card），不要使用 ../../',
            },
          ],
        },
      ],
    },
  },
  {
    // 声明文件里用 declare var 声明全局变量（与 TS 内置 lib.dom 的写法一致），
    // no-var 只针对运行时代码，这里关掉。
    files: ['**/*.d.ts'],
    rules: {
      'no-var': 'off',
    },
  },
]);
