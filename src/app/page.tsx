import { Footer } from '@/components/brand/Footer';
import { CtaFinal } from '@/components/sections/CtaFinal';
import { Faq } from '@/components/sections/Faq';
import { Hero } from '@/components/sections/Hero';
import { Problemas } from '@/components/sections/Problemas';
import { Servicios } from '@/components/sections/Servicios';
import { Sobre } from '@/components/sections/Sobre';
import { Testimonios } from '@/components/sections/Testimonios';

/**
 * Home — `/`.
 *
 * Spec anchors: AC-1.1.1 / AC-1.1.2 / AC-1.7.7.
 *
 * v1.0 home is a single 7-section emotional flow (O-6 §2). G_A-4 lands the
 * Hero section (S1) + Footer; G_A-5 adds Problemas (S2) + Servicios (S3);
 * G_A-6 closes with Sobre (S4) + Testimonios (S5) + FAQ (S6) + CTA-final (S7).
 *
 * Server Component by design (AC-1.7.7): `/` is a Server Component rendered
 * with SSR — no `"use client"` at top-level. Interactive children (e.g., the
 * eventual scroll-reveal animations) become client islands when added.
 */
export default function HomePage() {
  return (
    <>
      <Hero />
      <Problemas />
      <Servicios />
      <Sobre />
      <Testimonios />
      <Faq />
      <CtaFinal />
      <Footer />
    </>
  );
}
