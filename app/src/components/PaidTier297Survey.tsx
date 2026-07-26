import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Upload, X, FileText, Loader2 } from "lucide-react";
import {
  getPaid297Sections,
  PaidTier297Question,
} from "@/data/paidTier297Questions";
import { uploadFile } from "@/lib/assessment";

interface Props {
  contact: { name: string; email: string; contactId?: string };
  onComplete: (answers: Record<string, any>) => void;
}

interface UploadedFile { url: string; fileName: string; }

export const PaidTier297Survey = ({ contact, onComplete }: Props) => {
  const [sectionIdx, setSectionIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const sections = getPaid297Sections();
  const currentSection = sections[sectionIdx];
  const isLast = sectionIdx === sections.length - 1;
  const isFirst = sectionIdx === 0;

  const setAnswer = (id: string, value: any) =>
    setAnswers(prev => ({ ...prev, [id]: value }));

  const handleNext = () => {
    if (isLast) {
      onComplete({
        ...answers,
        supporting_documents: uploadedFiles.map(f => f.url),
      });
    } else {
      setSectionIdx(i => i + 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const handleBack = () => {
    if (!isFirst) {
      setSectionIdx(i => i - 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const handleFileSelect = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    const results = await Promise.all(
      Array.from(files).map(f => uploadFile(f, contact.contactId))
    );
    const successful = results
      .filter(r => r.success && r.url)
      .map(r => ({ url: r.url!, fileName: r.fileName }));
    const failed = results.filter(r => !r.success);
    
    if (failed.length > 0) {
      setUploadError(`${failed.length} file(s) failed: ${failed[0].error || "Unknown error"}`);
    }

    setUploadedFiles(prev => [...prev, ...successful]);
    setUploading(false);
  };

  const removeFile = (idx: number) =>
    setUploadedFiles(prev => prev.filter((_, i) => i !== idx));

  const renderQuestion = (q: PaidTier297Question) => {
    const value = answers[q.id] || "";
    if (q.type === "file") {
      return (
        <div className="space-y-4">
          <label className="block cursor-pointer">
            <div className="border-2 border-dashed border-border rounded-xl p-8 text-center hover:border-primary/50 transition-colors">
              <Upload className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">
                {uploading ? "Uploading…" : "Click or drag files to upload"}
              </p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                PDF, Excel, CSV, images · up to 25 MB each
              </p>
            </div>
            <input
              type="file"
              accept={q.acceptFileTypes}
              multiple={q.multipleFiles}
              onChange={(e) => {
                handleFileSelect(e.target.files);
                e.target.value = "";
              }}
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
                  <button onClick={() => removeFile(idx)} className="text-muted-foreground hover:text-destructive">
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
        </div>
      );
    }
    switch (q.type) {
      case "text":
        return (
          <Input
            type="text"
            value={value}
            onChange={(e) => setAnswer(q.id, e.target.value)}
            placeholder={q.placeholder}
            className="h-14 bg-secondary/40"
          />
        );
      case "textarea":
        return (
          <Textarea
            value={value}
            onChange={(e) => setAnswer(q.id, e.target.value)}
            placeholder={q.placeholder || "Type your response here"}
            className="min-h-[140px] bg-secondary/40"
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="w-full max-w-3xl mx-auto pt-48 md:pt-64 pb-32 px-4 space-y-8">
      <div className="text-center space-y-2">
        <p className="text-xs font-bold text-accent uppercase tracking-[0.3em]">$297 DEEP DIVE</p>
        <h2 className="font-display text-3xl md:text-4xl font-bold">{currentSection.name}</h2>
        <p className="text-sm text-muted-foreground">
          {contact.name ? `${contact.name.split(" ")[0]} · ` : ""}Section {sectionIdx + 1} of {sections.length}
        </p>
      </div>

      <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
        <motion.div
          className="h-full bg-primary"
          initial={{ width: 0 }}
          animate={{ width: `${((sectionIdx + 1) / sections.length) * 100}%` }}
          transition={{ duration: 0.4 }}
        />
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={sectionIdx}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          className="space-y-8 bg-card/40 border border-white/5 rounded-2xl p-8"
        >
          {currentSection.questions.map((q) => (
            <div key={q.id} className="space-y-3">
              <div className="space-y-1">
                {q.qNumber && (
                  <p className="text-xs text-accent font-mono uppercase tracking-widest">{q.qNumber}</p>
                )}
                <p className="text-base text-foreground font-medium">{q.text}</p>
              </div>
              {renderQuestion(q)}
            </div>
          ))}
        </motion.div>
      </AnimatePresence>

      <div className="flex justify-between items-center pt-4">
        {!isFirst ? (
          <Button onClick={handleBack} variant="ghost" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4 mr-2" /> Back
          </Button>
        ) : <div />}
        <Button onClick={handleNext} disabled={uploading} className="h-14 px-8 bg-primary hover:bg-primary/90 text-primary-foreground font-bold rounded-xl">
          {isLast ? "Generate My Deep Dive →" : "Continue →"}
        </Button>
      </div>
    </div>
  );
};

