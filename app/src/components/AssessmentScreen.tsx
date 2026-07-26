import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FREE_ASSESSMENT_SECTIONS, FreeAssessmentQuestion } from "@/data/freeAssessmentQuestions";
import { getReadableAnswer } from "@/lib/assessment";
import { GHL_SURVEY_SUBMIT_URL } from "@/lib/ghl-config";
import { QuestionCard } from "./QuestionCard";
import { ProgressBar } from "./ProgressBar";
import { ArrowLeft } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

interface AssessmentScreenProps {
  onComplete: (answers: Record<number, any>, leadData?: { name: string; email: string; businessName?: string; contactId?: string }) => void;
}

export const AssessmentScreen = ({ onComplete }: AssessmentScreenProps) => {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<number, any>>({});
  const [selectedOption, setSelectedOption] = useState<number | string | null>(null);
  const [showLeadCapture, setShowLeadCapture] = useState(false);
  const [name, setName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasCapturedLead, setHasCapturedLead] = useState(false);
  const [contactId, setContactId] = useState<string | undefined>(undefined);

  // Flatten questions and inject section titles
  const questions = FREE_ASSESSMENT_SECTIONS.flatMap(section => 
    section.questions.map(q => ({ ...q, sectionTitle: section.title }))
  );

  const currentQuestion = questions[currentIdx];

  const handleSelect = (value: number | string) => {
    setSelectedOption(value);
    
    // Auto-advance logic
    setTimeout(() => {
      const newAnswers = { ...answers, [currentQuestion.id]: value };
      setAnswers(newAnswers);
      setSelectedOption(null);
      
      // Trigger email gate after Q3 (Intake Profile is Q1-Q3)
      if (currentQuestion.id === 3 && !hasCapturedLead) {
        setShowLeadCapture(true);
        return;
      }

      if (currentIdx < questions.length - 1) {
        setCurrentIdx(currentIdx + 1);
      } else {
        // Complete the assessment
        handleSubmitFinal(newAnswers);
      }
    }, currentQuestion.type === "select" ? 400 : 0); // Only delay for select to show visual feedback
  };

  const handleBack = () => {
    if (showLeadCapture) {
      // Cannot go back from lead capture easily without losing flow, but we can allow it
      setShowLeadCapture(false);
      return;
    }
    if (currentIdx > 0) {
      setCurrentIdx(currentIdx - 1);
      setSelectedOption(null);
    }
  };

  const handleSubmitLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !email) return;
    
    setIsSubmitting(true);
    
    try {
      const formData = new FormData();
      formData.append("first_name", name.split(" ")[0]);
      formData.append("last_name", name.split(" ").slice(1).join(" "));
      formData.append("email", email);
      formData.append("company", businessName);
      
      // Add answers to formData up to this point
      Object.entries(answers).forEach(([qId, val]) => {
        const q = questions.find(x => x.id === Number(qId));
        if (q && q.fieldKey) {
          const readableVal = getReadableAnswer(val, q.options);
          formData.append(q.fieldKey, readableVal);
        }
      });

      const response = await fetch(GHL_SURVEY_SUBMIT_URL, {
        method: "POST",
        body: formData,
      });
      
      const data = await response.json();
      if (data.contactId) {
        setContactId(data.contactId);
      }
    } catch (error) {
      console.error("Error submitting to HighLevel:", error);
    } finally {
      setIsSubmitting(false);
      setHasCapturedLead(true);
      setShowLeadCapture(false);
      setCurrentIdx(currentIdx + 1); // Move to Q4
    }
  };

  const handleSubmitFinal = async (finalAnswers: Record<number, any>) => {
    try {
      const formData = new FormData();
      formData.append("first_name", name.split(" ")[0]);
      formData.append("last_name", name.split(" ").slice(1).join(" "));
      formData.append("email", email);
      formData.append("company", businessName);
      
      // Add all answers to formData
      Object.entries(finalAnswers).forEach(([qId, val]) => {
        const q = questions.find(x => x.id === Number(qId));
        if (q && q.fieldKey) {
          const readableVal = getReadableAnswer(val, q.options);
          formData.append(q.fieldKey, readableVal);
        }
      });

      const response = await fetch(GHL_SURVEY_SUBMIT_URL, {
        method: "POST",
        body: formData,
      });
      
      const data = await response.json();
      if (data.contactId) {
        setContactId(data.contactId);
      }
    } catch (error) {
      console.error("Error submitting final to HighLevel:", error);
    } finally {
      onComplete(finalAnswers, { name, email, businessName, contactId });
    }
  };

  // Exit prevention logic
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center p-4 pt-48 md:pt-64">
      <ProgressBar current={showLeadCapture ? 4 : currentIdx + 1} total={questions.length} />
      
      <div className="w-full max-w-[640px] space-y-8">
        <div className="flex items-center justify-between">
          <button
            onClick={handleBack}
            className={`flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors text-sm font-medium ${
              currentIdx === 0 && !showLeadCapture ? "invisible" : ""
            }`}
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          {!showLeadCapture && (
            <span className="font-mono text-[10px] text-accent uppercase tracking-widest">
              {currentQuestion?.sectionTitle} — {currentIdx + 1}/{questions.length}
            </span>
          )}
        </div>

        <AnimatePresence mode="wait">
          {showLeadCapture ? (
            <motion.div
              key="lead-capture"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="bg-card border border-border rounded-2xl p-8 md:p-12 shadow-xl"
            >
              <div className="text-center space-y-4 mb-8">
                <h2 className="font-display text-3xl font-bold text-foreground">Where should we send your results?</h2>
                <p className="text-muted-foreground">Enter your details to continue your personalized business health assessment.</p>
              </div>
              
              <form onSubmit={handleSubmitLead} className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="name">Full Name</Label>
                  <Input 
                    id="name" 
                    value={name} 
                    onChange={(e) => setName(e.target.value)} 
                    placeholder="John Doe" 
                    required 
                    className="h-14 bg-background"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="businessName">Business Name</Label>
                  <Input 
                    id="businessName" 
                    value={businessName} 
                    onChange={(e) => setBusinessName(e.target.value)} 
                    placeholder="Acme Corp" 
                    required 
                    className="h-14 bg-background"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input 
                    id="email" 
                    type="email" 
                    value={email} 
                    onChange={(e) => setEmail(e.target.value)} 
                    placeholder="john@company.com" 
                    required 
                    className="h-14 bg-background"
                  />
                </div>
                <Button 
                  type="submit" 
                  className="w-full h-14 text-lg font-bold bg-primary hover:bg-primary/90 text-primary-foreground"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Processing..." : "Continue Analysis →"}
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  Your information is secure and will never be shared.
                </p>
              </form>
            </motion.div>
          ) : (
            <motion.div
              key={currentIdx}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
            >
              <QuestionCard
                question={currentQuestion}
                selectedOption={selectedOption}
                onSelect={handleSelect}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

