---
name: Cyber-Orchestra
colors:
  surface: '#0b1326'
  surface-dim: '#0b1326'
  surface-bright: '#31394d'
  surface-container-lowest: '#060e20'
  surface-container-low: '#131b2e'
  surface-container: '#171f33'
  surface-container-high: '#222a3d'
  surface-container-highest: '#2d3449'
  on-surface: '#dae2fd'
  on-surface-variant: '#ccc3d8'
  inverse-surface: '#dae2fd'
  inverse-on-surface: '#283044'
  outline: '#958da1'
  outline-variant: '#4a4455'
  surface-tint: '#d2bbff'
  primary: '#d2bbff'
  on-primary: '#3f008e'
  primary-container: '#7c3aed'
  on-primary-container: '#ede0ff'
  inverse-primary: '#732ee4'
  secondary: '#4cd7f6'
  on-secondary: '#003640'
  secondary-container: '#03b5d3'
  on-secondary-container: '#00424e'
  tertiary: '#ffb2b7'
  on-tertiary: '#67001b'
  tertiary-container: '#c81a42'
  on-tertiary-container: '#ffdedf'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#eaddff'
  primary-fixed-dim: '#d2bbff'
  on-primary-fixed: '#25005a'
  on-primary-fixed-variant: '#5a00c6'
  secondary-fixed: '#acedff'
  secondary-fixed-dim: '#4cd7f6'
  on-secondary-fixed: '#001f26'
  on-secondary-fixed-variant: '#004e5c'
  tertiary-fixed: '#ffdadb'
  tertiary-fixed-dim: '#ffb2b7'
  on-tertiary-fixed: '#40000d'
  on-tertiary-fixed-variant: '#92002a'
  background: '#0b1326'
  on-background: '#dae2fd'
  surface-variant: '#2d3449'
typography:
  headline-xl:
    fontFamily: Montserrat
    fontSize: 48px
    fontWeight: '800'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Montserrat
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Montserrat
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
  headline-md:
    fontFamily: Montserrat
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-md:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
    letterSpacing: 0.05em
  label-sm:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 8px
  gutter-desktop: 24px
  gutter-mobile: 16px
  margin-page: 40px
  margin-mobile: 20px
  max-width: 1440px
---

## Brand & Style

The design system is engineered to evoke the immersive, high-fidelity atmosphere of modern gaming consoles and the nostalgic glow of retro arcades. The target audience includes gamers, developers, and music enthusiasts who treat game soundtracks as a premium art form. 

The visual style is a fusion of **Corporate Modern** precision and **Vaporwave** vibrancy. It utilizes a "Dark Mode First" philosophy, leaning into deep obsidian and charcoal surfaces to allow album art and neon accents to pop with maximum intensity. The emotional response is one of high-tech sophistication—clean, focused, and ultra-responsive—while maintaining a sense of digital mystery through subtle glows and translucent overlays.

## Colors

The palette is anchored in a foundational neutral (`#0F172A`) that provides a true-black feeling without total blackness, preserving detail in shadows. 

- **Primary (Electric Violet):** Used for interactive states, progress bars, and the "Modern Era" category.
- **Secondary (Cyber Cyan):** Used for notifications, active toggle states, and the "PC/Console" category.
- **Tertiary (Neon Rose):** Reserved for high-energy highlights, "Retro/8-bit" categories, and heart/like actions.
- **Surface Strategy:** Backgrounds utilize tiered charcoals. The deepest level is the main canvas, with slightly lighter elevations for cards and persistent navigation.

## Typography

Typography in this design system emphasizes hierarchy and technical precision. **Montserrat** provides the high-impact, geometric weight required for game titles and major section headers. **Inter** handles the heavy lifting for track listings and metadata, ensuring readability at smaller scales. **Geist** is introduced for labels and technical data (bitrate, duration, platform tags) to provide a monospaced, "developer-tool" aesthetic that resonates with tech-savvy users.

All headlines should use tighter letter-spacing for a modern, compressed look. Labels should be uppercase with generous tracking to contrast against body text.

## Layout & Spacing

The design system utilizes a **12-column fluid grid** for desktop and a **4-column grid** for mobile. A strict 8px base unit (the "Power of 8") governs all padding and margins. 

- **Desktop:** Side navigation is fixed (240px). Content flows in the remaining space. Cards for games use a flexible grid that scales from 6 to 3 columns depending on viewport width.
- **Mobile:** Elements switch to a single-column scrollable list. The "Now Playing" bar becomes a floating pill or bottom-docked sheet.
- **Rhythm:** Use "Gutter-Desktop" for space between cards and "Unit" multiples for internal card padding (e.g., 2x unit for internal card content).

## Elevation & Depth

This design system avoids traditional drop shadows in favor of **Tonal Layers** and **Inner Glows**. 

1. **Base Layer:** The darkest surface (`#0F172A`).
2. **Surface Layer:** Cards and secondary containers use a subtle lift (`#1E293B`).
3. **Glassmorphism:** The "Now Playing" bar and side navigation use a 20px backdrop blur with a 10% white border-top to simulate frosted glass.
4. **Active State Glow:** Instead of shadows, active elements (like the currently playing track) emit a soft, 8px outer glow matching their era-specific accent color (Purple, Cyan, or Rose).

## Shapes

The shape language is "Soft-Tech." Elements are not overly rounded, maintaining a structured and organized feel. 

- **Primary Radius:** 4px (Soft) for all buttons, inputs, and track list items.
- **Large Radius:** 8px (Rounded-LG) for album art and main content containers.
- **Pill:** Reserved exclusively for "Genre" tags and the "Now Playing" progress handle.

This sharp-but-tempered approach ensures the UI feels professional and precise, avoiding the "bubbly" look of consumer social apps.

## Components

- **Buttons:** Primary buttons use a solid gradient of the accent color. Secondary buttons use a "Ghost" style with a 1px border and 10% opacity fill.
- **Game Cards:** Large, vertical rectangles. On hover, the album art should slightly scale (1.05x) and a subtle neon border-glow should appear.
- **Track Lists:** Zebra-striping is avoided. Instead, use a subtle background change (`#FFFFFF` at 5% opacity) on hover. Meta-data like duration should be right-aligned in `label-sm` typography.
- **Now Playing Bar:** A full-width persistent bar at the bottom. The background is a blurred translucent pane. The progress bar is 4px high, using the primary accent color with a glowing play-head.
- **Era Chips:** Small tags used to categorize music (e.g., "16-bit", "Orchestral"). These use the `label-sm` font with high-contrast backgrounds based on the Era color mapping.
- **Inputs:** Search bars should be dark with a 1px border. When focused, the border color transitions to the Primary accent color with a subtle inner glow.