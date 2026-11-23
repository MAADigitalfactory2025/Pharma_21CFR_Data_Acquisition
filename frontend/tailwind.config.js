/** FBD pages use Tailwind, scoped to .fbd-root and re-colored with the login project's palette. */
export default {
  content: ['./src/fbd/**/*.{js,jsx}'],
  important: '.fbd-root',
  corePlugins: { preflight: false },
  theme: {
    extend: {
      colors: {
        primary: { 50: '#eef5f1', 100: '#dcebe3', 200: '#bcd6c8', 300: '#8fb1a0', 400: '#5f8b78', 500: '#3b6555', 600: '#284c40', 700: '#18392e', 800: '#233d34', 900: '#142a22' },
        ok: '#3b8c62', warn: '#d97706', alarm: '#dc2626', neutral: '#78817c',
      },
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'], mono: ['JetBrains Mono', 'Consolas', 'monospace'] },
    },
  },
  plugins: [],
};
