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
    externals: {
      inline: [],
      external: ['@prisma/client', '.prisma/client'],
    },
  },
  supabase: {
    redirect: false,
  },
})