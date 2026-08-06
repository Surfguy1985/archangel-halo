import { Card, CardContent } from '@/components/ui/card';
import { Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link } from 'wouter';

export default function NotFound() {
  return (
    <div className="h-full w-full flex flex-col items-center justify-center bg-background p-6">
      <div className="w-32 h-32 rounded-full bg-muted flex items-center justify-center mb-8 shadow-inner">
        <Compass className="w-16 h-16 text-muted-foreground opacity-40" />
      </div>
      
      <h1 className="text-3xl font-extrabold text-foreground mb-3 tracking-tight">
        Off the path
      </h1>
      
      <p className="text-lg text-muted-foreground mb-10 text-center max-w-[280px]">
        Looks like you wandered into an empty area. Let's get you back on track.
      </p>

      <Link href="/">
        <Button className="h-14 px-8 rounded-full text-lg font-bold shadow-float">
          Return to Start
        </Button>
      </Link>
    </div>
  );
}
