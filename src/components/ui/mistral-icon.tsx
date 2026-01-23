export function MistralIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
    >
      <title>Mistral AI</title>
      {/* Row 1 - Two squares at top corners */}
      <path fill="currentColor" d="M3.428 3.4h3.429v3.428H3.428V3.4" />
      <path fill="currentColor" d="M17.142 3.4h3.43v3.428h-3.43V3.4" />
      {/* Row 2 - Two bars */}
      <path fill="currentColor" d="M3.428 6.828h6.857v3.429H3.429V6.828" />
      <path fill="currentColor" d="M13.714 6.828h6.857v3.429h-6.857V6.828" />
      {/* Row 3 - Full bar */}
      <path fill="currentColor" d="M3.428 10.258h17.144v3.428H3.428v-3.428" />
      {/* Row 4 - Three squares */}
      <path fill="currentColor" d="M3.428 13.686h3.429v3.428H3.428v-3.428" />
      <path fill="currentColor" d="M10.286 13.686h3.429v3.428h-3.429v-3.428" />
      <path fill="currentColor" d="M17.142 13.686h3.43v3.428h-3.43v-3.428" />
      {/* Row 5 - Two bars at bottom */}
      <path fill="currentColor" d="M0 17.114h10.286v3.429H0v-3.429" />
      <path fill="currentColor" d="M13.714 17.114H24v3.429H13.714v-3.429" />
    </svg>
  );
}
