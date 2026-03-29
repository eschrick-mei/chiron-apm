import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./node_modules/@tremor/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    transparent: "transparent",
    current: "currentColor",
    extend: {
      colors: {
        // Base dark theme
        "chiron-bg": {
          primary: "#0a0e17",
          secondary: "#0d1321",
          tertiary: "#131a2e",
        },
        // Accent colors
        "chiron-accent": {
          teal: "#2dd4bf",
          cyan: "#22d3ee",
          purple: "#818cf8",
        },
        // Text colors
        "chiron-text": {
          primary: "#f1f5f9",
          secondary: "#cbd5e1",
          muted: "#64748b",
        },
        // Status colors
        "chiron-status": {
          success: "#22c55e",
          warning: "#eab308",
          danger: "#ef4444",
        },
        // Tremor color overrides
        tremor: {
          brand: {
            faint: "rgba(45, 212, 191, 0.1)",
            muted: "rgba(45, 212, 191, 0.2)",
            subtle: "#2dd4bf",
            DEFAULT: "#2dd4bf",
            emphasis: "#14b8a6",
            inverted: "#0a0e17",
          },
          background: {
            muted: "#0d1321",
            subtle: "#131a2e",
            DEFAULT: "#0a0e17",
            emphasis: "#1e293b",
          },
          border: {
            DEFAULT: "rgba(45, 212, 191, 0.2)",
          },
          ring: {
            DEFAULT: "rgba(45, 212, 191, 0.4)",
          },
          content: {
            subtle: "#64748b",
            DEFAULT: "#94a3b8",
            emphasis: "#f1f5f9",
            strong: "#f8fafc",
            inverted: "#0a0e17",
          },
        },
      },
      boxShadow: {
        "chiron-glow": "0 0 20px rgba(45, 212, 191, 0.3)",
        "chiron-glow-lg": "0 0 30px rgba(45, 212, 191, 0.4)",
      },
      backgroundImage: {
        "chiron-gradient":
          "linear-gradient(135deg, #0d1321 0%, #131a2e 100%)",
        "chiron-header":
          "linear-gradient(90deg, #2dd4bf 0%, #22d3ee 50%, #818cf8 100%)",
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
    },
  },
  safelist: [
    {
      pattern:
        /^(bg-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950))$/,
      variants: ["hover", "ui-selected"],
    },
    {
      pattern:
        /^(text-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950))$/,
      variants: ["hover", "ui-selected"],
    },
    {
      pattern:
        /^(border-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950))$/,
      variants: ["hover", "ui-selected"],
    },
    {
      pattern:
        /^(ring-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950))$/,
    },
    {
      pattern:
        /^(stroke-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950))$/,
    },
    {
      pattern:
        /^(fill-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950))$/,
    },
  ],
  plugins: [],
};

export default config;
