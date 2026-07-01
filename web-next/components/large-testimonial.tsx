export function LargeTestimonial() {
  return (
    <section className="w-full px-5 overflow-hidden flex justify-center items-center">
      <div className="flex-1 flex flex-col justify-start items-start overflow-hidden">
        <div className="self-stretch px-4 py-12 md:px-6 md:py-16 lg:py-28 flex flex-col justify-start items-start gap-2">
          <div className="self-stretch flex justify-between items-center">
            <div className="flex-1 px-4 py-8 md:px-12 lg:px-20 md:py-8 lg:py-10 overflow-hidden rounded-2xl bg-card border border-border shadow-[0_2px_12px_rgba(46,38,32,0.07)] flex flex-col justify-center items-center gap-6 md:gap-8 lg:gap-10">
              <div className="w-full max-w-[900px] text-center text-foreground font-display leading-snug md:leading-snug lg:leading-tight font-medium text-xl md:text-3xl lg:text-5xl text-balance">
                &ldquo;The community voted to weight reply depth twice as high last epoch. The feed changed the next morning. That&apos;s what <em className="text-primary not-italic">no black box</em> actually means.&rdquo;
              </div>
              <div className="flex justify-start items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-muted border border-border overflow-hidden flex items-center justify-center">
                  <svg viewBox="0 0 48 48" className="w-full h-full">
                    <rect width="48" height="48" fill="hsl(var(--muted))" />
                    <circle cx="24" cy="19" r="9" fill="hsl(var(--border))" />
                    <ellipse cx="24" cy="44" rx="16" ry="11" fill="hsl(var(--border))" />
                  </svg>
                </div>
                <div className="flex flex-col justify-start items-start">
                  <div className="text-foreground text-base font-semibold leading-6">morgan.bsky.social</div>
                  <div className="text-foreground/50 text-sm font-normal leading-6">Community organiser, Bluesky</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
