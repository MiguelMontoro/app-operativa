import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';

export default [
  {
    ignores: ['dist/**/*', 'node_modules/**/*', 'src/**/*', 'public/**/*', 'server.ts', '*.ts', '*.tsx'],
  },
  firebaseRulesPlugin.configs['flat/recommended'],
];
