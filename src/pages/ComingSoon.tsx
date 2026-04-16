import { Card, CardContent } from '@/components/ui/card';
import { Sparkles } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * Generic placeholder for modules that are wired into the sidebar but
 * whose full implementation is still pending. Keeps navigation honest
 * (no 404s, no dead links) and signals to the user what's coming next.
 */
export default function ComingSoon({
  title,
  description,
  icon: Icon = Sparkles,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
}) {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">{title}</h1>
      <p className="text-muted-foreground mb-6 text-sm">
        {description ?? 'This module is part of the Brand Idea agency toolkit.'}
      </p>

      <Card>
        <CardContent className="py-16 flex flex-col items-center text-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Icon className="w-7 h-7 text-primary" />
          </div>
          <div className="space-y-1 max-w-md">
            <h2 className="font-semibold">Coming soon</h2>
            <p className="text-sm text-muted-foreground">
              {title} is being built. You can see it here in the sidebar so the
              team knows it's on the roadmap — the full experience ships shortly.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
