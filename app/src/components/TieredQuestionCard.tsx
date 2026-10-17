import { motion } from "framer-motion";
import { Check, Info, Upload, X, FileText, Loader2 } from "lucide-react";
import { ReactNode } from "react";
import { Textarea } from "./ui/textarea";
import { Input } from "./ui/input";
import { Button } from "./ui/button";

// Shared visual chrome for every intake question across all three tiers.
// Mirrors the free-tier QuestionCard look (glass card, gold numbered badge,
// Playfair headline, big rounded option cards, "YOUR ANSWER IS ANONYMOUS"
// footer) so a buyer stepping from free → $47 → $297 sees one continuous
// visual language and only the dot-progression eyebrow (set by the parent
// via <TierEyebrow />) tells them which tier they're on.
export interface TieredQuestionOption { value: string; label: string; }

interface UploadedFile { url: string; fileName: string; }

interface Props {
  // Visual
  badgeNumber: string;        // "1", "12", "A" — rendered in the gold circle
  title: string;              // Playfair headline
  text: string;               // body prompt
  showTrustFooter?: boolean;

  // Interaction
  type: "text" | "textarea" | "select" | "dollar" | "file";
  value?: string;
  onChange?: (v: string) => void;
  onSelect?: (v: string) => void;     // for `select` — auto-advances
  onContinue?: () => void;            // for text/textarea/dollar/file
  continueLabel?: string;
  continueDisabled?: boolean;
  placeholder?: string;
  options?: TieredQuestionOption[];
  selectedValue?: string;

  // File-upload only
  uploadedFiles?: UploadedFile[];
  uploading?: boolean;
  uploadError?: string | null;
  acceptFileTypes?: string;
  multipleFiles?: boolean;
  onFileSelect?: (files: FileList | null) => void;
  onFileRemove?: (idx: number) => void;

  // Extra content slot (e.g. required-answer warning)
  footerSlot?: ReactNode;
}

export const TieredQuestionCard = (props: Props) => {
  const {
    badgeNumber, title, text, showTrustFooter,
    type, value = "", onChange, onSelect, onContinue,
    continueLabel = "Continue →", continueDisabled,
    placeholder, options, selectedValue,
    uploadedFiles = [], uploading, uploadError,
    acceptFileTypes, multipleFiles, onFileSelect, onFileRemove,
    footerSlot,
  } = props;

  return (
    <div className="space-y-8 p-8 md:p-12 glass-card rounded-2xl border border-white/5 bg-card/40 backdrop-blur-xl shadow-card transition-all duration-200">
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <span className="flex h-7 min-w-[1.75rem] px-1.5 items-center justify-center rounded-full bg-primary/20 text-[11px] font-bold text-primary font-mono">
            {badgeNumber}
          </span>
          <h3 className="font-display text-3xl md:text-4xl text-foreground font-bold leading-tight">
            {title}
          </h3>
        </div>
        <p className="text-muted-foreground text-lg mt-2">{text}</p>
      </div>

      <div className="grid gap-4">
        {(type === "text" || type === "dollar") && (
          <div className="space-y-6">
            <Input
              placeholder={placeholder || "Type your response here..."}
              className="h-14 bg-secondary/40 border-border focus:border-primary focus:ring-primary/20 text-foreground rounded-xl px-6 text-lg"
              value={value}
              onChange={(e) => onChange?.(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && onContinue) onContinue(); }}
            />
            <Button
              onClick={onContinue}
              disabled={continueDisabled}
              className="w-full h-16 bg-primary text-primary-foreground font-bold text-lg rounded-xl shadow-glow-gold hover:scale-[1.01] transition-transform"
            >
              {continueLabel}
            </Button>
          </div>
        )}

        {type === "textarea" && (
          <div className="space-y-6">
            <Textarea
              placeholder={placeholder || "Type your response here..."}
              className="min-h-[160px] bg-secondary/40 border-border focus:border-primary focus:ring-primary/20 text-foreground resize-none rounded-xl p-6 text-lg"
              value={value}
              onChange={(e) => onChange?.(e.target.value)}
            />
            <Button
              onClick={onContinue}
              disabled={continueDisabled}
              className="w-full h-16 bg-primary text-primary-foreground font-bold text-lg rounded-xl shadow-glow-gold hover:scale-[1.01] transition-transform"
            >
              {continueLabel}
            </Button>
          </div>
        )}

        {type === "select" && options && (
          options.map((option, idx) => (
            <motion.button
              key={idx}
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              onClick={() => onSelect?.(option.value)}
              className={`w-full p-6 text-left rounded-xl border transition-all flex items-center justify-between group relative overflow-hidden ${
                selectedValue === option.value
                  ? "bg-primary/10 border-primary border-l-[3px]"
                  : "bg-secondary/40 border-border hover:border-primary/50 hover:bg-primary/5"
              }`}
            >
              <span className={`text-lg transition-colors ${
                selectedValue === option.value ? "text-foreground font-medium" : "text-muted-foreground group-hover:text-foreground"
              }`}>
                {option.label}
              </span>
              <div className={`h-6 w-6 rounded-full border flex items-center justify-center transition-colors ${
                selectedValue === option.value ? "border-primary bg-primary" : "border-white/10 group-hover:border-primary/50"
              }`}>
                {selectedValue === option.value && <Check className="h-4 w-4 text-primary-foreground" />}
              </div>
            </motion.button>
          ))
        )}

        {type === "file" && (
          <div className="space-y-6">
            <label className="block cursor-pointer">
              <div className="border-2 border-dashed border-border rounded-xl p-10 text-center hover:border-primary/50 transition-colors">
                <Upload className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">
                  {uploading ? "Uploading…" : "Click or drag files to upload"}
                </p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  PDF, Excel, CSV, images · up to 25 MB each
                </p>
              </div>
              <input
                type="file"
                accept={acceptFileTypes}
                multiple={multipleFiles}
                onChange={(e) => { onFileSelect?.(e.target.files); e.target.value = ""; }}
                disabled={uploading}
                className="hidden"
              />
            </label>

            {uploadError && (
              <div className="text-sm text-destructive font-medium p-3 bg-destructive/10 rounded-lg border border-destructive/20">
                {uploadError}
              </div>
            )}

            {uploadedFiles.length > 0 && (
              <div className="space-y-2">
                {uploadedFiles.map((file, idx) => (
                  <div key={idx} className="flex items-center gap-3 p-3 rounded-lg bg-secondary/40 border border-white/5">
                    <FileText className="h-4 w-4 text-primary shrink-0" />
                    <span className="text-sm flex-1 truncate">{file.fileName}</span>
                    <button onClick={() => onFileRemove?.(idx)} className="text-muted-foreground hover:text-destructive">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {uploading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Uploading…
              </div>
            )}

            <Button
              onClick={onContinue}
              disabled={continueDisabled || uploading}
              className="w-full h-16 bg-primary text-primary-foreground font-bold text-lg rounded-xl shadow-glow-gold hover:scale-[1.01] transition-transform"
            >
              {continueLabel}
            </Button>
          </div>
        )}
      </div>

      {footerSlot}

      {showTrustFooter && (
        <div className="flex items-center justify-center gap-2 text-[10px] text-muted-foreground uppercase tracking-widest pt-4">
          <Info className="h-3 w-3" />
          <span>Your answer is anonymous until you choose to share it.</span>
        </div>
      )}
    </div>
  );
};

// Three-dot progression eyebrow shown above every intake card. Dots are the
// only tier differentiator in the UI — pricing stays out of the chrome
// (customer directive, 2026-10-17). Pass the tier name verbatim; the parent
// also passes `progress` ("3/17") so the buyer can see where they are.
interface EyebrowProps {
  tier: "free" | "paid_47" | "paid_297";
  progress?: string;
}

export const TierEyebrow = ({ tier, progress }: EyebrowProps) => {
  const dots =
    tier === "free"     ? "● ○ ○" :
    tier === "paid_47"  ? "● ● ○" :
                          "● ● ●";
  const name =
    tier === "free"     ? "BUSINESS HEALTH CHECK" :
    tier === "paid_47"  ? "FULL DIAGNOSTIC" :
                          "BUSINESS GROWTH ANALYSIS";
  return (
    <span className="font-mono text-[10px] text-accent uppercase tracking-widest">
      {dots}   {name}{progress ? `  ·  ${progress}` : ""}
    </span>
  );
};
