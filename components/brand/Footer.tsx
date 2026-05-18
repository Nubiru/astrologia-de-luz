import { LOGO_WORDMARK, Logo } from './Logo';

export type FooterProps = {
  year?: number;
  className?: string;
};

export function Footer({ year, className = '' }: FooterProps) {
  const renderedYear = year ?? new Date().getFullYear();
  return (
    <footer
      data-brand="footer"
      className={`bg-tinta-nocturna text-blanco-estelar py-12 px-6 sm:px-10 ${className}`}
    >
      <div className="mx-auto max-w-5xl flex flex-col items-center gap-6 text-center">
        <Logo variant="primary" size="sm" />
        <p className="font-body text-xs text-plata-eterea">
          © {renderedYear} {LOGO_WORDMARK}
        </p>
      </div>
    </footer>
  );
}
