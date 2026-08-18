/**
 * Brand Logo
 * ----------
 * Brand logo using the official TimeTrack icon asset with wordmark.
 */

import { Link } from 'react-router-dom';
import { cn } from '../../lib/utils';

interface BrandLogoProps {
  size?: 'sm' | 'md' | 'lg';
  animated?: boolean;
  showWordmark?: boolean;
}

const sizeClasses = {
  sm: { icon: 'w-7 h-7', text: 'text-sm' },
  md: { icon: 'w-9 h-9', text: 'text-base' },
  lg: { icon: 'w-12 h-12', text: 'text-xl' },
};

export default function BrandLogo({ size = 'md', animated = false, showWordmark = true }: BrandLogoProps) {
  const classes = sizeClasses[size];

  return (
    <Link to="/" className="flex items-center gap-2.5 group" aria-label="TimeTrack Home">
      <img
        src="/TimeTrack Icon.png"
        alt="TimeTrack Logo"
        className={cn(
          'rounded-xl object-cover shadow-lg shadow-brand/25 transition-transform duration-300',
          classes.icon,
          animated && 'group-hover:scale-105 group-hover:rotate-3',
        )}
      />
      {showWordmark && (
        <div className="flex flex-col">
          <span className={cn('font-bold tracking-tight text-foreground leading-none', classes.text)}>
            <span className="gradient-text">TimeTrack</span>
          </span>
          <span className="text-[9px] text-muted-foreground font-medium tracking-widest uppercase">
            Time & Attendance
          </span>
        </div>
      )}
    </Link>
  );
}