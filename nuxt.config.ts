export default defineNuxtConfig({
  css: [
    '~~/assets/css/main.css',
    '~~/assets/css/ticket-theme.css',
  ],
  compatibilityDate: "2025-07-15",
  devtools: { enabled: true },
  modules: [
    "@nuxtjs/tailwindcss",
    "@pinia/nuxt",
    "@vueuse/nuxt",
    "@nuxtjs/supabase",
    "nuxt-lucide-icons",
  ],
  nitro: {
    preset: 'vercel',
    rollupConfig: {
      output: {
        intro: `
          import { createRequire as __prismaCreateRequire } from 'module';
          import { fileURLToPath as __prismaFileURLToPath } from 'url';
          import { dirname as __prismaDirname } from 'path';
          const require = __prismaCreateRequire(import.meta.url);
          const __filename = __prismaFileURLToPath(import.meta.url);
          const __dirname = __prismaDirname(__filename);
        `,
      },
    },
  },
  supabase: {
    redirect: false,
  },
})