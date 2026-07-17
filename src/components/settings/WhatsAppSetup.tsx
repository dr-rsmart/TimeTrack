import { client } from "@/api/Client";
import { Button } from "@/components/ui/button";
import { MessageCircle } from "lucide-react";
import { motion } from "framer-motion";

export default function WhatsAppSetup() {
  const whatsappUrl = "https://wa.me/bot_number"; // Placeholder for local dev

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card rounded-2xl border border-border p-6 space-y-4"
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[#25D366]/10 flex items-center justify-center">
          <MessageCircle className="w-5 h-5 text-[#25D366]" />
        </div>
        <div>
          <h2 className="font-semibold">WhatsApp Bot</h2>
          <p className="text-xs text-muted-foreground">Let employees clock in/out via WhatsApp</p>
        </div>
      </div>

      <div className="space-y-3 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">How it works:</p>
        <ol className="space-y-2 list-none">
          {[
            "Employee opens the WhatsApp link below",
            'They send "clock in" or "clock out"',
            "The bot asks them to share their GPS location",
            "If within any active geofence → clock in/out is recorded",
            "If outside all geofences → request is denied",
          ].map((step, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                {i + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
      </div>

      <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className="block">
        <Button className="w-full rounded-xl bg-[#25D366] hover:bg-[#1ebe5d] text-white border-0">
          <MessageCircle className="w-4 h-4 mr-2" />
          Connect to WhatsApp
        </Button>
      </a>
      <p className="text-xs text-muted-foreground text-center">
        Share this link with your employees so they can connect the bot
      </p>
    </motion.div>
  );
}