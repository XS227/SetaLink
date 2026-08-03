/**
 * RealGram's existing mark (brand/realgram.svg — "the bubble with a spark:
 * connect + earn"), reproduced unmodified per the brief's "preserve
 * existing RealGram logo" instruction. Purple stays purple; this prototype
 * does not recolor the logo itself, only the surrounding chrome.
 */
export function RealGramLogo({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color: "var(--logo-purple)" }}
      role="img"
      aria-label="RealGram"
    >
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2.5 21.5z" />
      <path d="M12 8.5v6" />
      <path d="M9 11.5h6" />
    </svg>
  );
}
