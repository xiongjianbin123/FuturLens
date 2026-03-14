/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // 金融主题色
        bull: '#26a69a',   // 阳线绿
        bear: '#ef5350',   // 阴线红
        panel: 'rgba(13, 17, 23, 0.85)',
        border: 'rgba(255, 255, 255, 0.08)',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Consolas', 'monospace'],
      },
    }
  },
  plugins: []
}
