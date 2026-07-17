import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { client } from "@/api/Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Clock, Eye, EyeOff, Sparkles, Shield } from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";

// Owner-only passcode — change this to your own secret code
const DEMO_PASSCODE = "demo2026";

export default function Login() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showDemo, setShowDemo] = useState(false);
  const [passcode, setPasscode] = useState("");

  const nextUrl = searchParams.get("next") || "/";

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await client.auth.loginViaEmailPassword(email, password);
      window.location.href = nextUrl;
    } catch (err) {
      toast.error(err.message || "Login failed. Please check your credentials.");
      setLoading(false);
    }
  };

  const handleDemoAccess = (e) => {
    e.preventDefault();
    if (passcode === DEMO_PASSCODE) {
      setSearchParams({ next: "/demo" });
      toast.success("Demo access granted. Please sign in to continue.");
      setShowDemo(false);
      setPasscode("");
    } else {
      toast.error("Invalid access code");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-accent/50 p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center mx-auto mb-3 shadow-lg shadow-primary/25">
            <Clock className="w-7 h-7 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Workforce</h1>
          <p className="text-sm text-muted-foreground mt-1">Sign in to your account</p>
        </div>

        <Card className="border-border/50 shadow-xl">
          <CardContent className="pt-6">
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  required
                  autoComplete="email"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <Button type="submit" disabled={loading} className="w-full h-10">
                {loading ? "Signing in..." : "Sign In"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="mt-4">
          <button
            onClick={() => setShowDemo(!showDemo)}
            className="w-full text-center text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors flex items-center justify-center gap-1.5 py-2"
          >
            <Sparkles className="w-3 h-3" />
            Demo Company Access
          </button>
          <AnimatePresence>
            {showDemo && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <Card className="border-primary/20 bg-primary/5">
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-3">
                      <Shield className="w-4 h-4 text-primary" />
                      <span>Owner-only demo access</span>
                    </div>
                    <form onSubmit={handleDemoAccess} className="space-y-3">
                      <Input
                        type="password"
                        value={passcode}
                        onChange={(e) => setPasscode(e.target.value)}
                        placeholder="Enter access code"
                        autoFocus
                      />
                      <Button type="submit" variant="secondary" className="w-full">
                        Access Demo
                      </Button>
                    </form>
                  </CardContent>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}