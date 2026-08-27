/**
 * Reusable UI primitives (Tailwind + Radix-free where possible).
 * Kept intentionally small and dependency-light.
 */

import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/utils';

// ── Button ──
type ButtonVariant = 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive';
type ButtonSize = 'default' | 'sm' | 'lg' | 'icon';

const variantClasses: Record<ButtonVariant, string> = {
  default: 'bg-primary text-primary-foreground hover:bg-primary/90',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
  outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
  ghost: 'hover:bg-accent hover:text-accent-foreground',
  destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
};

const sizeClasses: Record<ButtonSize, string> = {
  default: 'h-10 px-4 py-2',
  sm: 'h-9 rounded-md px-3',
  lg: 'h-11 rounded-md px-8',
  icon: 'h-10 w-10',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = 'Button';

// ── Card ──
export function Card({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('rounded-lg border bg-card text-card-foreground shadow-sm', className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('flex flex-col space-y-1.5 p-6', className)}>{children}</div>;
}

export function CardTitle({ className, children }: { className?: string; children: ReactNode }) {
  return <h3 className={cn('text-lg font-semibold leading-none tracking-tight', className)}>{children}</h3>;
}

export function CardDescription({ className, children }: { className?: string; children: ReactNode }) {
  return <p className={cn('text-sm text-muted-foreground', className)}>{children}</p>;
}

export function CardContent({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('p-6 pt-0', className)}>{children}</div>;
}

// ── Input ──
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

// ── Textarea ──
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';

// ── Select ──
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = 'Select';

// ── Label ──
export function Label({ className, children, htmlFor }: { className?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className={cn('text-sm font-medium leading-none', className)}>
      {children}
    </label>
  );
}

// ── Badge ──
type BadgeVariant = 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline';
const badgeVariants: Record<BadgeVariant, string> = {
  default: 'bg-primary text-primary-foreground',
  secondary: 'bg-secondary text-secondary-foreground',
  success: 'bg-emerald-100 text-emerald-800',
  warning: 'bg-amber-100 text-amber-800',
  destructive: 'bg-destructive text-destructive-foreground',
  outline: 'border border-input text-foreground',
};

export function Badge({ className, variant = 'default', children, title }: { className?: string; variant?: BadgeVariant; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold', badgeVariants[variant], className)}>
      {children}
    </span>
  );
}

// ── Table ──
export function Table({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className="relative w-full overflow-auto">
      <table className={cn('w-full caption-bottom text-sm', className)}>{children}</table>
    </div>
  );
}

export function TableHeader({ children }: { children: ReactNode }) {
  return <thead className="[&_tr]:border-b">{children}</thead>;
}

export function TableBody({ children }: { children: ReactNode }) {
  return <tbody className="[&_tr:last-child]:border-0">{children}</tbody>;
}

export function TableRow({ className, children }: { className?: string; children: ReactNode }) {
  return <tr className={cn('border-b transition-colors hover:bg-muted/50', className)}>{children}</tr>;
}

export function TableHead({ className, children }: { className?: string; children: ReactNode }) {
  return <th className={cn('h-12 px-4 text-left align-middle font-medium text-muted-foreground', className)}>{children}</th>;
}

export function TableCell({ className, children, colSpan }: { className?: string; children: ReactNode; colSpan?: number }) {
  return <td className={cn('p-4 align-middle', className)} colSpan={colSpan}>{children}</td>;
}

// ── Modal ──
// Rendered via a React portal directly into document.body so that ancestor
// CSS transforms (e.g. page entrance animations) cannot break its
// `position: fixed` positioning. The overlay itself scrolls, so tall modals
// (Add Location, Add Shift, etc.) always appear on screen without the user
// having to scroll the underlying page.
export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative flex min-h-full items-center justify-center p-4">
        <div
          className={cn(
            'z-10 max-h-[85vh] w-full overflow-y-auto rounded-lg border bg-background p-6 shadow-lg',
            wide ? 'max-w-3xl' : 'max-w-lg',
          )}
        >
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">{title}</h2>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close">
              ✕
            </button>
          </div>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Spinner ──
export function Spinner({ className }: { className?: string }) {
  return (
    <div
      className={cn('h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-primary', className)}
      role="status"
      aria-label="Loading"
    />
  );
}

// ── Empty state ──
export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

// ── Stat card ──
export function StatCard({
  label,
  value,
  sub,
  icon,
  trend,
  trendUp,
  onClick,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon?: ReactNode;
  trend?: string;
  trendUp?: boolean;
  /** When provided the card becomes a clickable drill-down trigger. */
  onClick?: () => void;
}) {
  const clickable = Boolean(onClick);
  return (
    <Card
      onClick={onClick}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={clickable ? `${label} — view details` : undefined}
      className={cn(
        'relative overflow-hidden border-border/50 shadow-card hover:shadow-glass transition-all duration-300 group',
        clickable &&
          'cursor-pointer hover:border-brand/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-brand to-brand-light opacity-0 group-hover:opacity-100 transition-opacity" />
      <CardContent className="flex items-center gap-4 p-5">
        {icon && (
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand/10 text-brand shrink-0">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
          <p className="text-2xl font-bold tracking-tight">{value}</p>
          <div className="flex items-center gap-2">
            {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
            {trend && (
              <span className={cn('text-xs font-semibold', trendUp ? 'text-emerald-500' : 'text-red-500')}>
                {trend}
              </span>
            )}
          </div>
        </div>
      </CardContent>
      {clickable && (
        <span className="pointer-events-none absolute bottom-2 right-3 text-[10px] font-semibold text-brand opacity-0 transition-opacity group-hover:opacity-100">
          View details →
        </span>
      )}
    </Card>
  );
}

// ── Switch ──
export function Switch({
  checked,
  onCheckedChange,
  disabled,
  'aria-label': ariaLabel,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  'aria-label'?: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-brand' : 'bg-muted-foreground/25',
      )}
    >
      <span
        className={cn(
          'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-6' : 'translate-x-1',
        )}
      />
    </button>
  );
}

// ── Tabs ──
export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: string; label: string; icon?: ReactNode }[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-1 p-1 rounded-xl bg-secondary/50 w-max">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200',
            active === tab.id
              ? 'bg-card text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {tab.icon}
          {tab.label}
        </button>
      ))}
    </div>
  );
}

// ── Skeleton ──
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} />;
}

// ── Avatar ──
export function Avatar({
  name,
  src,
  size = 'md',
  className,
}: {
  name: string;
  src?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const initials = name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const sizeClasses = {
    sm: 'w-7 h-7 text-[10px]',
    md: 'w-9 h-9 text-xs',
    lg: 'w-12 h-12 text-sm',
  };

  return (
    <div
      className={cn(
        'rounded-full font-bold flex items-center justify-center bg-brand/10 text-brand border border-brand/20 overflow-hidden shrink-0',
        sizeClasses[size],
        className,
      )}
    >
      {src ? <img src={src} alt={name} className="w-full h-full object-cover" /> : initials}
    </div>
  );
}

// ── Progress ──
export function Progress({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn('h-2 w-full rounded-full bg-secondary overflow-hidden', className)}>
      <div
        className="h-full rounded-full bg-gradient-to-r from-brand to-brand-light transition-all duration-500"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}
