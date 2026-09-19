import { defineConfig } from 'vitepress'

const base = (process.env.DOCS_BASE_PATH ?? '/trackify/docs/').replace(/\/?$/, '/')

export default defineConfig({
  lang: 'en',
  title: 'Trackify',
  titleTemplate: ':title · Trackify Docs',
  description:
    'User documentation for Trackify — the self-hosted web player for video game music. Learn how to run an instance, build your library, and listen in the browser.',

  base,
  appearance: 'dark',

  // Isolate from any root-level PostCSS config — Vite would otherwise walk
  // up and load it, failing when root node_modules is absent.
  vite: {
    css: { postcss: { plugins: [] } },
  },

  themeConfig: {
    nav: [{ text: 'Guide', link: '/', activeMatch: '^/$' }],

    sidebar: [
      {
        text: 'Start',
        items: [{ text: 'Getting Started', link: '/getting-started/' }],
      },
      {
        text: 'Using Trackify',
        items: [
          { text: 'Browsing Collections', link: '/browsing/' },
          { text: 'Playlists & Favorites', link: '/playlists/' },
          { text: 'The Player & Formats', link: '/player/' },
        ],
      },
      {
        text: 'Your Library',
        items: [{ text: 'Adding Music', link: '/adding-music/' }],
      },
      {
        text: 'Self-Hosting',
        items: [
          { text: 'Hosting & Running', link: '/hosting/' },
          { text: 'Administration', link: '/admin/' },
        ],
      },
      {
        text: 'Help',
        items: [
          { text: 'Troubleshooting', link: '/troubleshooting/' },
          { text: 'FAQ', link: '/faq/' },
        ],
      },
    ],

    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: 'Search docs', buttonAriaLabel: 'Search docs' },
        },
      },
    },

    socialLinks: [{ icon: 'github', link: 'https://github.com/mode777/trackify' }],

    outline: { level: [2, 3], label: 'On this page' },

    footer: {
      message:
        'Trackify user documentation — runs Highly Experimental, Game Music Emu, NEZplug++, LazyUSF2 & VGMPlay in WebAssembly, plus PocketBase',
      copyright:
        'All video game music remains the property of its respective rights holders. Trackify is a fan project.',
    },
  },
})
