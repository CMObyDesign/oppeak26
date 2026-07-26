import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import Upsell from "./pages/Upsell";
import PaidTier47 from "./pages/PaidTier47";
import PaidTier297 from "./pages/PaidTier297";
import AuditConfirmed from "./pages/AuditConfirmed";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/paid-47" element={<PaidTier47 />} />
          <Route path="/paid-297" element={<PaidTier297 />} />
          <Route path="/upsell" element={<Upsell />} />
          <Route path="/audit-confirmed" element={<AuditConfirmed />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

