import { useState } from "react";

interface SaveForLaterProps {
  /** When true, the confirmation also mentions the emailed resume link (paid tiers). */
  emailHint?: boolean;
}

/**
 * A low-pressure "Save & finish later" affordance. Progress is already persisted
 * by each survey's autosave, so this button doesn't save anything new — it just
 * gives the visitor explicit permission to step away and reassurance that they
 * won't lose their place.
 */
export const SaveForLater = ({ emailHint }: SaveForLaterProps) => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="text-center pt-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-xs text-muted-foreground/70 hover:text-foreground underline underline-offset-4"
        >
          Save &amp; finish later
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 p-4">
          <div className="w-full max-w-md bg-card border border-border rounded-2xl p-8 text-center shadow-xl">
            <h3 className="font-display text-2xl font-bold text-foreground mb-3">We get it — you're busy.</h3>
            <p className="text-sm text-muted-foreground mb-6">
              Your progress is saved on this device. Step away whenever you need to —
              when you come back, you'll pick up right where you left off
              {emailHint ? ", or return anytime using the link in your email." : "."}
            </p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="h-11 px-6 rounded-lg bg-primary text-primary-foreground font-bold"
            >
              Keep going
            </button>
          </div>
        </div>
      )}
    </>
  );
};
