import { motion } from "framer-motion";

export const ProgressBar = ({ current, total }: { current: number; total: number }) => {
  // Psychological momentum: slightly "cheat" forward after Q4
  const displayProgress = current > 4 
    ? ((current + 0.5) / (total + 0.5)) * 100 
    : (current / total) * 100;

  return (
    <div className="fixed top-0 left-0 w-full h-[3px] bg-border z-[100]">
      <motion.div
        className="h-full bg-primary"
        initial={{ width: 0 }}
        animate={{ width: `${displayProgress}%` }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        role="progressbar"
        aria-valuenow={current}
        aria-valuemin={1}
        aria-valuemax={total}
      />
    </div>
  );
};

